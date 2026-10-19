/**
 * Running the app under test with its providers emulated: `startApp` starts it with a shell
 * command (a dev server, usually) and waits until it answers, and `appEnvironment` puts the
 * services behind one proxy, starts the app through that proxy and hands the runner the worker
 * environment. Any app a command starts works, with no code of its own.
 */
import type { ChildProcess } from "node:child_process"

import { spawnOwned } from "../support/children.ts"
import type { ProcessLog, WorkerEnvironment } from "./environment.ts"
import { type Service, startServices, type UnroutedHosts, unroutedOf } from "./services.ts"

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
  /** How long to wait for it to answer; default two minutes, for a dev server's first build. */
  readonly timeoutMs?: number
  /**
   * When it counts as started: `url` answering (the default), a `path` under it answering (a
   * health check), or a `log` line in its output, for a worker that serves nothing.
   */
  readonly ready?: { readonly path?: string; readonly log?: string | RegExp }
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

/** Whether anything answers HTTP at `url` right now, whatever the status. */
async function answers(url: string): Promise<boolean> {
  try {
    await fetch(url, { signal: AbortSignal.timeout(2_000), redirect: "manual" })

    return true
  } catch {
    return false
  }
}

/** Every line a child writes, the last `LOGGED_LINES` of them kept, and how many in all. */
function captureOutput(child: ChildProcess): { readonly lines: string[]; written: number } {
  const output = { lines: [] as string[], written: 0 }

  const keep = (chunk: Buffer) => {
    const lines = chunk.toString().split("\n").filter(Boolean)

    output.written += lines.length
    output.lines.push(...lines)
    output.lines.splice(0, Math.max(0, output.lines.length - LOGGED_LINES))
  }

  child.stdout?.on("data", keep)
  child.stderr?.on("data", keep)

  return output
}

/** The app's environment: the proxy's, its port, then its own, with NODE_OPTIONS joined. */
function appEnv(app: AppCommand, env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const port = new URL(app.url).port
  const own = app.env ?? {}
  const joined = (name: "NODE_OPTIONS" | "BUN_OPTIONS") =>
    own[name] === undefined ? {} : { [name]: [own[name], env[name]].filter(Boolean).join(" ") }

  return {
    ...env,
    ...(port !== "" && { PORT: port }),
    ...own,
    ...joined("NODE_OPTIONS"),
    ...joined("BUN_OPTIONS"),
  }
}

/** Whether the app has started, by its `ready` rule. */
async function isReady(app: AppCommand, lines: readonly string[]): Promise<boolean> {
  const log = app.ready?.log

  if (log !== undefined)
    return lines.some((line) => (typeof log === "string" ? line.includes(log) : log.test(line)))

  return answers(new URL(app.ready?.path ?? "", app.url).href)
}

/** How long the app and what it started get to exit on SIGTERM before they are killed. */
const STOP_GRACE_MS = 5_000

/** Resolves once the app is ready; rejects when the child exits first or `timeoutMs` passes. */
async function untilReady(
  child: ChildProcess,
  app: AppCommand,
  output: { readonly lines: readonly string[] },
): Promise<void> {
  const timeoutMs = app.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const deadline = Date.now() + timeoutMs
  const recent = () => output.lines.slice(-KEPT_LINES).join("\n")
  const what =
    app.ready?.log === undefined ? `${app.url} answered` : `it logged ${String(app.ready.log)}`
  let exit: string | undefined

  child.once("exit", (code, signal) => {
    exit = signal === null ? `exited with code ${code}` : `was stopped by ${signal}`
  })

  while (!(await isReady(app, output.lines))) {
    if (exit !== undefined) throw new Error(`the app ${exit} before ${what}\n${recent()}`)
    if (Date.now() > deadline)
      throw new Error(`the app was not ready (${what}) within ${timeoutMs / 1000} s\n${recent()}`)
    await new Promise((resolve) => setTimeout(resolve, POLL_MS))
  }
}

/**
 * Starts the app with `app.command` and `env` (the proxy's, from `proxy.env()`), and resolves
 * once `app.url` answers. Refuses to start when something already answers there: danwo would
 * test that server, whose calls to providers do not go through the proxy.
 */
export async function startApp(
  app: AppCommand,
  env: NodeJS.ProcessEnv = process.env,
): Promise<StartedApp> {
  if (await answers(app.url))
    throw new Error(
      `something already answers at ${app.url}: stop it so danwo can start the app through its proxy, or set APP_URL to test the app that runs there (its calls to providers then reach the real ones)`,
    )

  /* Its own process group: a dev command often runs the server as its own child, and both go. */
  const owned = spawnOwned(app.command, [], {
    shell: true,
    cwd: app.cwd,
    env: appEnv(app, env),
    stdio: ["ignore", "pipe", "pipe"],
  })
  const output = captureOutput(owned.child)

  try {
    await untilReady(owned.child, app, output)
  } catch (error) {
    await owned.stop(STOP_GRACE_MS)
    throw error
  }

  let stopping = false
  let exit: string | undefined

  owned.child.once("exit", (code, signal) => {
    if (!stopping) exit = signal === null ? `exited with code ${code}` : `was stopped by ${signal}`
  })

  return {
    url: app.url,
    pid: owned.child.pid,
    logs: () => ({ lines: [...output.lines], written: output.written }),
    exited: () => exit,
    stop: () => {
      stopping = true

      return owned.stop(STOP_GRACE_MS)
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

  try {
    if (typeof app === "object") started = await startApp(app, services.proxy.env())
  } catch (error) {
    await services.close()
    throw error
  }

  const baseUrl = typeof app === "string" ? app : started?.url

  return {
    ...(baseUrl !== undefined && { baseUrl }),
    proxy: services.proxy,
    webhooks: services.webhooks,
    fixtures: services.fixtures,
    /* Where the services' mail lands (Clerk's codes, Resend's emails), for the `mail` fixture. */
    ...(services.mail && { mail: services.mail }),
    logs: (): Readonly<Record<string, ProcessLog>> =>
      started === undefined ? {} : { app: started.logs() },
    stopped: () => {
      const exit = started?.exited()

      return exit === undefined ? [] : [`the app ${exit}`]
    },
    state: () => services.state(),
    settle: () => services.settle(),
    travel: (ms) => services.travel(ms),
    reset: () => services.reset(),
    snapshot: () => services.snapshot(),
    restore: () => services.restore(),
    async close() {
      await started?.stop()
      await services.close()
    },
  }
}
