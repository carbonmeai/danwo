/**
 * Running the app under test with its providers emulated: `startApp` starts it with a shell
 * command (a dev server, usually) and waits until it answers, and `appEnvironment` puts the
 * services behind one proxy, starts the app through that proxy and hands the runner the worker
 * environment. Any app a command starts works, with no code of its own.
 */
import type { ChildProcess } from "node:child_process"
import { once } from "node:events"

import { spawnOwned } from "../support/children.ts"
import { checkRouting, routingRefusal, unroutedProblems } from "./app-checks.ts"
import type { ProcessLog, WorkerEnvironment } from "./environment.ts"
import {
  type Service,
  servicesLifecycle,
  startServices,
  type UnroutedHosts,
  unroutedOf,
} from "./services.ts"

/** How danwo starts the app. */
export interface AppCommand {
  /** The command that starts it, run by the shell in `cwd`: e.g. `npm run dev`. */
  readonly command: string
  /** Where it answers once it runs, e.g. `http://localhost:3000`; its port is passed as `PORT`. */
  readonly url: string
  /** The folder to run the command in; default the current one. */
  readonly cwd?: string
  /**
   * More environment for the app, over the proxy's. A `NODE_OPTIONS` (or `BUN_OPTIONS`) here is
   * joined with the proxy's rather than replacing it, so the app keeps danwo's preload.
   */
  readonly env?: Readonly<Record<string, string>>
  /**
   * What it inherits of danwo's own environment, under the proxy's variables and `env`: all of it
   * (`true`, the default), only what a shell needs to run a command (`false`: `PATH`, `HOME`,
   * `TMPDIR`, the locale and the like), or that plus the names listed, where `NEXT_PUBLIC_*`
   * matches a prefix. Off, the CI's tokens and danwo's own model key never reach the app.
   */
  readonly inheritEnv?: boolean | readonly string[]
  /** How long to wait for it to answer; default two minutes, for a dev server's first build. */
  readonly timeoutMs?: number
  /**
   * When it counts as started: `url` answering (the default), a `path` under it answering (a
   * health check), a `log` line in its output, for a worker that serves nothing, or `exit`: the
   * command exiting with code 0, for one that starts a service and returns once it is up, such as
   * `docker compose up --wait`. Such a command's exit is not the app going down.
   */
  readonly ready?: {
    readonly path?: string
    readonly log?: string | RegExp
    readonly exit?: boolean
  }
  /**
   * A command that stops what `command` started, run by the shell in `cwd` when the app stops,
   * after its own processes: e.g. `docker compose down`, since containers outlive the command.
   */
  readonly stop?: string
}

/** An app `startApp` started. */
export interface StartedApp {
  readonly url: string
  /** The process group's leader: the shell that runs the command. */
  readonly pid: number | undefined
  /** What it has written to stdout and stderr so far, line by line (the last lines only). */
  logs(): ProcessLog
  /** How it ended when it stopped on its own after starting (`exited with code 1`); else undefined. */
  exited(): string | undefined
  /** Stops the command and every process it started. */
  stop(): Promise<void>
}

const DEFAULT_TIMEOUT_MS = 120_000
const POLL_MS = 250
/** Lines of the app's output kept for the error when it fails to start. */
const KEPT_LINES = 30
/** Lines of the app's output kept for the flight record. */
const LOGGED_LINES = 2_000

/**
 * What a command needs of the environment to run at all, on any platform: where programs are,
 * the home and temporary folders, the user, the locale and the terminal. `LC_*` is kept too.
 */
const ESSENTIAL_VARIABLES = [
  "PATH",
  "HOME",
  "USER",
  "LOGNAME",
  "SHELL",
  "TMPDIR",
  "TMP",
  "TEMP",
  "LANG",
  "LANGUAGE",
  "LC_*",
  "TERM",
  "TZ",
  "SYSTEMROOT",
  "WINDIR",
  "COMSPEC",
  "PATHEXT",
  "USERPROFILE",
  "USERNAME",
  "SYSTEMDRIVE",
  "HOMEDRIVE",
  "HOMEPATH",
  "APPDATA",
  "LOCALAPPDATA",
  "PROGRAMDATA",
  "PROGRAMFILES",
  "PROGRAMFILES(X86)",
  "NUMBER_OF_PROCESSORS",
  "PROCESSOR_ARCHITECTURE",
]

/** Whether `name` is `pattern`, or starts with its prefix for a `PREFIX_*` pattern; any case. */
function named(name: string, pattern: string): boolean {
  const upper = name.toUpperCase()
  const wanted = pattern.toUpperCase()

  return wanted.endsWith("*") ? upper.startsWith(wanted.slice(0, -1)) : upper === wanted
}

/**
 * What the app inherits of `base` (danwo's own environment), by its `inheritEnv`: all of it by
 * default, else only the essentials and the names it lists. The proxy's variables go on top.
 */
export function inheritedEnv(
  app: Pick<AppCommand, "inheritEnv">,
  base: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  const inherit = app.inheritEnv ?? true

  if (inherit === true) return base

  const patterns = [...ESSENTIAL_VARIABLES, ...(inherit === false ? [] : inherit)]

  return Object.fromEntries(
    Object.entries(base).filter(([name]) => patterns.some((pattern) => named(name, pattern))),
  )
}

/** Whether anything answers HTTP at `url` right now, whatever the status. */
async function answers(url: string): Promise<boolean> {
  try {
    await fetch(url, { signal: AbortSignal.timeout(2_000), redirect: "manual" })

    return true
  } catch {
    return false
  }
}

/**
 * Every line a child writes, the last `LOGGED_LINES` of them kept, and how many in all: into
 * `output` when given, so a stop command's lines follow the app's.
 */
function captureOutput(
  child: ChildProcess,
  output: { lines: string[]; written: number } = { lines: [], written: 0 },
): { lines: string[]; written: number } {
  const keep = (chunk: Buffer) => {
    const lines = chunk.toString().split(/\r?\n/).filter(Boolean)

    output.written += lines.length
    output.lines.push(...lines)
    output.lines.splice(0, Math.max(0, output.lines.length - LOGGED_LINES))
  }

  child.stdout?.on("data", keep)
  child.stderr?.on("data", keep)

  return output
}

/**
 * The app's environment: the proxy's, its port, then its own, with NODE_OPTIONS and BUN_OPTIONS
 * joined. The proxy's BUN_OPTIONS stays first: its preload may be a quoted option, which Bun
 * misreads after a bare flag such as `--smol`.
 */
function appEnv(app: AppCommand, env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const port = new URL(app.url).port
  const own = app.env ?? {}

  const joined = (name: "NODE_OPTIONS" | "BUN_OPTIONS") => {
    const parts = name === "BUN_OPTIONS" ? [env[name], own[name]] : [own[name], env[name]]

    return own[name] === undefined ? {} : { [name]: parts.filter(Boolean).join(" ") }
  }

  return {
    ...env,
    ...(port !== "" && { PORT: port }),
    ...own,
    ...joined("NODE_OPTIONS"),
    ...joined("BUN_OPTIONS"),
  }
}

/** How the command ended, as the errors and `exited()` say it. */
function howItEnded(code: number | null, signal: NodeJS.Signals | null): string {
  return signal === null ? `exited with code ${code}` : `was stopped by ${signal}`
}

/** What the app being ready means, for the errors: `http://… answered`. */
function readiness(app: AppCommand): string {
  if (app.ready?.exit === true) return "its command exited with code 0"
  if (app.ready?.log !== undefined) return `it logged ${String(app.ready.log)}`

  return `${app.ready?.path === undefined ? app.url : new URL(app.ready.path, app.url).href} answered`
}

/**
 * The app's last lines of output, for an error, or that it printed nothing: a command that waits
 * on something (a container's health, a prompt) without saying so is the likely stall then.
 */
function lastOutput(lines: readonly string[]): string {
  return lines.length === 0 ? "(it printed nothing)" : lines.slice(-KEPT_LINES).join("\n")
}

/** Whether the app has started, by its `ready` rule; `exit` is how its command ended, if it has. */
async function isReady(
  app: AppCommand,
  lines: readonly string[],
  exit: string | undefined,
): Promise<boolean> {
  const log = app.ready?.log

  if (app.ready?.exit === true) return exit === howItEnded(0, null)
  if (log !== undefined)
    return lines.some((line) => (typeof log === "string" ? line.includes(log) : log.test(line)))

  return answers(new URL(app.ready?.path ?? "", app.url).href)
}

/** How long the app and what it started get to exit on SIGTERM before they are killed. */
const STOP_GRACE_MS = 5_000

/** How long `app.stop` gets to finish before it is ended too. */
const STOP_COMMAND_MS = 60_000

/**
 * Resolves once the app is ready; rejects when the child exits first or `timeoutMs` passes,
 * with its last lines of output. It watches the command's exit, not its output closing: a
 * container or daemon the command started may hold its output open long after it has returned.
 */
async function untilReady(
  child: ChildProcess,
  app: AppCommand,
  output: { readonly lines: readonly string[] },
): Promise<void> {
  const timeoutMs = app.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const deadline = Date.now() + timeoutMs
  const what = readiness(app)
  let exit: string | undefined

  child.once("exit", (code, signal) => {
    exit = howItEnded(code, signal)
  })

  while (!(await isReady(app, output.lines, exit))) {
    if (exit !== undefined)
      throw new Error(`the app ${exit} before ${what}\n${lastOutput(output.lines)}`)
    if (Date.now() > deadline)
      throw new Error(
        `the app was not ready (${what}) within ${timeoutMs / 1000} s; its last output:\n${lastOutput(output.lines)}`,
      )
    await new Promise((resolve) => setTimeout(resolve, POLL_MS))
  }
}

/**
 * Runs `app.stop`, if any, with its output added to the app's, and ends it if it has not
 * finished within `STOP_COMMAND_MS`.
 */
async function runStop(
  app: AppCommand,
  env: NodeJS.ProcessEnv,
  output: { lines: string[]; written: number },
): Promise<void> {
  if (app.stop === undefined) return

  const owned = spawnOwned(app.stop, [], {
    shell: true,
    cwd: app.cwd,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  })

  captureOutput(owned.child, output)
  await Promise.race([
    once(owned.child, "exit").catch(() => undefined),
    new Promise((resolve) => setTimeout(resolve, STOP_COMMAND_MS).unref()),
  ])
  await owned.stop(STOP_GRACE_MS)
}

/**
 * Starts the app with `app.command` and `env` (the proxy's, from `proxy.env()`), and resolves
 * once it is ready (`app.url` answers, by default). Refuses to start when something already
 * answers there: danwo would test that server, whose calls to providers do not go through the
 * proxy. The command reads no input: its stdin is empty, so nothing waits on a prompt.
 */
export async function startApp(
  app: AppCommand,
  env: NodeJS.ProcessEnv = process.env,
): Promise<StartedApp> {
  if (await answers(app.url))
    throw new Error(
      `something already answers at ${app.url}: stop it so danwo can start the app through its proxy, or set APP_URL to test the app that runs there (its calls to providers then reach the real ones)`,
    )

  const ownEnv = appEnv(app, env)
  /* Its own process group: a dev command often runs the server as its own child, and both go. */
  const owned = spawnOwned(app.command, [], {
    shell: true,
    cwd: app.cwd,
    env: ownEnv,
    stdio: ["ignore", "pipe", "pipe"],
  })
  const output = captureOutput(owned.child)

  const stopAll = async () => {
    await owned.stop(STOP_GRACE_MS)
    await runStop(app, ownEnv, output)
  }

  try {
    await untilReady(owned.child, app, output)
  } catch (error) {
    await stopAll()
    throw error
  }

  let stopping = false
  let exit: string | undefined

  /* A command that is ready once it exits has already exited, so this never fires for it. */
  owned.child.once("exit", (code, signal) => {
    if (!stopping) exit = howItEnded(code, signal)
  })

  return {
    url: app.url,
    pid: owned.child.pid,
    logs: () => ({ lines: [...output.lines], written: output.written }),
    exited: () => exit,
    stop: () => {
      stopping = true

      return stopAll()
    },
  }
}

/** Options of `appEnvironment()`. */
export interface AppEnvironmentOptions extends UnroutedHosts {
  /**
   * The app: how danwo starts it, or the URL of one that already runs (whose own calls to
   * providers then reach the real ones). Leave it out when there is no server to start, as for a
   * mobile app that calls providers itself.
   */
  readonly app?: AppCommand | string
  /** Emulated providers, e.g. `[stripeService(), resendService()]`, behind one proxy. */
  readonly services?: readonly (Service | Promise<Service>)[]
}

/**
 * A worker environment for any app: the services behind one proxy, the app started through it
 * (so its calls to Stripe, Resend and the rest reach the emulators with no code change), and the
 * lifecycle `danwo matrix` needs. The app keeps running between tests and matrix trials; resets
 * put the services back to their seeds.
 */
export async function appEnvironment(
  options: AppEnvironmentOptions = {},
): Promise<WorkerEnvironment> {
  const pending = (options.services ?? []).map((service) => Promise.resolve(service))
  const services = await startServices(await Promise.all(pending), unroutedOf(options))
  const { app } = options
  let started: StartedApp | undefined

  const strict = options.unmatched === "block"
  let notes: string[] = []

  try {
    if (typeof app === "object")
      started = await startApp(
        app,
        services.proxy.env(inheritedEnv(app, process.env), { requireProxy: strict }),
      )
  } catch (error) {
    /* An app process that exited at start because it missed the proxy: say so, not only "exited". */
    const problems = await unroutedProblems(services.proxy)

    await services.close()
    throw problems.length === 0 ? error : new Error(routingRefusal(problems), { cause: error })
  }

  try {
    notes = await checkRouting(services.proxy, strict)
  } catch (error) {
    await started?.stop()
    await services.close()
    throw error
  }

  const baseUrl = typeof app === "string" ? app : started?.url

  return {
    ...(baseUrl !== undefined && { baseUrl }),
    proxy: services.proxy,
    webhooks: services.webhooks,
    fixtures: services.fixtures,
    ...servicesLifecycle(services),
    logs: (): Readonly<Record<string, ProcessLog>> =>
      started === undefined ? {} : { app: started.logs() },
    stopped: () => {
      const exit = started?.exited()

      return exit === undefined ? [] : [`the app ${exit}`]
    },
    notes: () => notes,
    state: () => services.state(),
    async close() {
      await started?.stop()
      await services.close()
    },
  }
}
