/**
 * Running the app under test with its providers emulated: `startApp` starts it with a shell
 * command (a dev server, usually) and waits until it answers, and `appEnvironment` puts the
 * services behind one proxy, starts the app through that proxy and hands the runner the worker
 * environment. Any app a command starts works, with no code of its own.
 */
import type { ChildProcess } from "node:child_process"

import { spawnOwned } from "../support/children.ts"
import type { WorkerEnvironment } from "./environment.ts"
import { type Service, startServices } from "./services.ts"

/** How danwo starts the app. */
export interface AppCommand {
  /** The command that starts it, run by the shell in `cwd`: e.g. `npm run dev`. */
  readonly command: string
  /** Where it answers once it runs, e.g. `http://localhost:3000`; its port is passed as `PORT`. */
  readonly url: string
  /** The folder to run the command in; default the current one. */
  readonly cwd?: string
  /** More environment for the app, over the proxy's. */
  readonly env?: Readonly<Record<string, string>>
  /** How long to wait for it to answer; default two minutes, for a dev server's first build. */
  readonly timeoutMs?: number
}

/** An app `startApp` started. */
export interface StartedApp {
  readonly url: string
  /** Stops the command and every process it started. */
  stop(): Promise<void>
}

const DEFAULT_TIMEOUT_MS = 120_000
const POLL_MS = 250
/** Lines of the app's output kept for the error when it fails to start. */
const KEPT_LINES = 30

/** Whether anything answers HTTP at `url` right now, whatever the status. */
async function answers(url: string): Promise<boolean> {
  try {
    await fetch(url, { signal: AbortSignal.timeout(2_000), redirect: "manual" })

    return true
  } catch {
    return false
  }
}

/** The last lines a child wrote, for an error message. */
function tail(child: ChildProcess): () => string {
  const lines: string[] = []

  const keep = (chunk: Buffer) => {
    lines.push(...chunk.toString().split("\n").filter(Boolean))
    lines.splice(0, Math.max(0, lines.length - KEPT_LINES))
  }

  child.stdout?.on("data", keep)
  child.stderr?.on("data", keep)

  return () => lines.join("\n")
}

/** How long the app and what it started get to exit on SIGTERM before they are killed. */
const STOP_GRACE_MS = 5_000

/** Resolves once `url` answers; rejects when the child exits first or `timeoutMs` passes. */
async function untilAnswering(
  child: ChildProcess,
  url: string,
  timeoutMs: number,
  output: () => string,
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  let exit: string | undefined

  child.once("exit", (code, signal) => {
    exit = signal === null ? `exited with code ${code}` : `was stopped by ${signal}`
  })

  while (!(await answers(url))) {
    if (exit !== undefined) throw new Error(`the app ${exit} before ${url} answered\n${output()}`)
    if (Date.now() > deadline)
      throw new Error(`the app did not answer at ${url} within ${timeoutMs / 1000} s\n${output()}`)
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

  const port = new URL(app.url).port
  /* Its own process group: a dev command often runs the server as its own child, and both go. */
  const owned = spawnOwned(app.command, [], {
    shell: true,
    cwd: app.cwd,
    env: { ...env, ...(port !== "" && { PORT: port }), ...app.env },
    stdio: ["ignore", "pipe", "pipe"],
  })
  const output = tail(owned.child)

  try {
    await untilAnswering(owned.child, app.url, app.timeoutMs ?? DEFAULT_TIMEOUT_MS, output)
  } catch (error) {
    await owned.stop(STOP_GRACE_MS)
    throw error
  }

  return { url: app.url, stop: () => owned.stop(STOP_GRACE_MS) }
}

/** Options of `appEnvironment()`. */
export interface AppEnvironmentOptions {
  /**
   * The app: how danwo starts it, or the URL of one that already runs (whose own calls to
   * providers then reach the real ones). Leave it out when there is no server to start, as for a
   * mobile app that calls providers itself.
   */
  readonly app?: AppCommand | string
  /** Emulated providers, e.g. `[stripeService(), resendService()]`, behind one proxy. */
  readonly services?: readonly (Service | Promise<Service>)[]
  /** What happens to calls for hosts no service answers; default they pass through. */
  readonly unmatched?: "passthrough" | "block"
  /** Hosts answered as blocked even when others pass through. */
  readonly blocked?: readonly string[]
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
  const services = await startServices(await Promise.all(pending), {
    ...(options.unmatched && { unmatched: options.unmatched }),
    ...(options.blocked && { blocked: options.blocked }),
  })
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
