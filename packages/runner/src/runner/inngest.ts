/**
 * Inngest as a service: the apps send events to `inngest.danwo.test`, which the proxy routes to an
 * Inngest dev server (started here, or one already running), so every event a test causes is a
 * call the flight record shows and `danwo matrix` can fault. `settle()` waits until the function
 * runs those events triggered have finished, so an invariant reads what the background jobs wrote,
 * and the record keeps each run's function, status and duration.
 */
import type { OutboundCall, OutboundFault, Proxy } from "@danwo/proxy"

import { type OwnedChild, spawnOwned } from "../support/children.ts"
import type { Service } from "./services.ts"

/** The host the apps send Inngest events to; the proxy routes it to the dev server. */
export const INNGEST_HOST = "inngest.danwo.test"

/** Options of `inngestService()`. */
export interface InngestOptions {
  /** Where the dev server answers; default `http://127.0.0.1:8288`. */
  readonly url?: string
  /**
   * Start the dev server: `true` runs `npx --yes inngest-cli dev`, a string is the command to run
   * instead. Leave it out to use one that already runs at `url`.
   */
  readonly start?: boolean | string
  /** The apps' Inngest endpoints the dev server calls, e.g. `http://127.0.0.1:4100/api/inngest`. */
  readonly apps?: readonly string[]
  /** How long `settle()` waits for runs to finish; default 30 seconds. */
  readonly settleTimeoutMs?: number
}

/** One function run an event triggered, as the flight record keeps it. */
export interface InngestRun {
  readonly event: string
  readonly runId: string
  readonly functionId: string
  readonly status: string
  readonly durationMs: number | null
}

/** What `inngestService()` returns: the service, and the environment the apps need. */
export interface InngestService extends Service {
  /**
   * Environment for every app that sends events or serves functions: the dev-mode flag and the
   * routed base URL, e.g. `env: { ...inngest.env }`.
   */
  readonly env: Readonly<Record<string, string>>
}

/** Run statuses that will not change any more. */
const DONE = new Set(["completed", "failed", "cancelled"])
/**
 * How long an event may show no runs before `settle()` takes it as triggering none: a busy dev
 * server takes a few seconds to schedule what an event triggers.
 */
const NO_RUNS_MS = 5_000
const POLL_MS = 150

/** The ids the dev server gave the events in one recorded send (`{ "ids": [...] }`). */
function eventIds(body: string | null | undefined): string[] {
  try {
    const parsed: unknown = JSON.parse(body ?? "")

    if (typeof parsed !== "object" || parsed === null || !("ids" in parsed)) return []

    return Array.isArray(parsed.ids) ? parsed.ids.filter((id) => typeof id === "string") : []
  } catch {
    return []
  }
}

/** A run from the dev server's `/v1/events/<id>/runs`, or undefined when it is not one. */
function runOf(event: string, value: unknown): InngestRun | undefined {
  if (typeof value !== "object" || value === null) return undefined

  const field = (name: string) => {
    const raw: unknown = Reflect.get(value, name)

    return typeof raw === "string" ? raw : ""
  }

  const started = Date.parse(field("run_started_at"))
  const ended = Date.parse(field("ended_at"))

  return {
    event,
    runId: field("run_id"),
    functionId: field("function_id"),
    status: field("status").toLowerCase(),
    durationMs: Number.isNaN(started) || Number.isNaN(ended) ? null : ended - started,
  }
}

async function runsOf(url: string, event: string): Promise<InngestRun[]> {
  try {
    const response = await fetch(new URL(`/v1/events/${encodeURIComponent(event)}/runs`, url))
    const body: unknown = await response.json()
    const data = typeof body === "object" && body !== null && "data" in body ? body.data : []

    return Array.isArray(data) ? data.flatMap((run) => runOf(event, run) ?? []) : []
  } catch {
    return []
  }
}

async function answers(url: string): Promise<boolean> {
  try {
    await fetch(url, { signal: AbortSignal.timeout(1_000) })

    return true
  } catch {
    return false
  }
}

/** Starts the dev server when asked, and waits for it to answer. */
async function startDevServer(
  options: InngestOptions,
  url: string,
): Promise<OwnedChild | undefined> {
  if (options.start === undefined || options.start === false) return undefined

  const port = new URL(url).port || "8288"
  const command =
    typeof options.start === "string"
      ? options.start
      : `npx --yes inngest-cli dev --no-discovery --port ${port} ${(options.apps ?? []).map((app) => `-u ${app}`).join(" ")}`
  const owned = spawnOwned(command, [], { shell: true, stdio: "ignore" })
  const deadline = Date.now() + 120_000

  while (!(await answers(url))) {
    if (Date.now() > deadline) {
      await owned.stop()
      throw new Error(`the Inngest dev server did not answer at ${url} within 120 s`)
    }

    await new Promise((resolve) => setTimeout(resolve, 250))
  }

  return owned
}

/**
 * Inngest for `startServices`: events the apps send to `inngest.danwo.test` reach the dev server
 * through the proxy, `settle` waits for the runs they triggered, and `state` lists those runs.
 */
export async function inngestService(options: InngestOptions = {}): Promise<InngestService> {
  const url = options.url ?? "http://127.0.0.1:8288"
  const owned = await startDevServer(options, url)
  let proxy: Proxy | undefined
  let runs: InngestRun[] = []

  /** Events sent through the proxy since the last reset, which clears the proxy's log. */
  const sentEvents = () =>
    (proxy?.exchanges() ?? [])
      .filter((e) => e.host === INNGEST_HOST && e.method === "POST" && e.path.startsWith("/e/"))
      .flatMap((e) => eventIds(e.response?.body))

  /**
   * Waits until every event sent so far has finished its runs, the ones those runs send included:
   * the sent events are read again on every poll, and each event gets its own time to show runs.
   */
  const settle = async () => {
    const deadline = Date.now() + (options.settleTimeoutMs ?? 30_000)
    const firstSeen = new Map<string, number>()

    for (;;) {
      const events = sentEvents()
      const now = Date.now()

      for (const event of events) if (!firstSeen.has(event)) firstSeen.set(event, now)

      const all = (await Promise.all(events.map((event) => runsOf(url, event)))).flat()
      const waiting = events.some((event) => {
        const own = all.filter((run) => run.event === event)

        return own.length === 0
          ? Date.now() - (firstSeen.get(event) ?? now) < NO_RUNS_MS
          : own.some((r) => !DONE.has(r.status))
      })

      runs = all
      if (!waiting) return
      if (Date.now() > deadline)
        throw new Error(
          `Inngest runs were still going after ${options.settleTimeoutMs ?? 30_000} ms`,
        )
      await new Promise((resolve) => setTimeout(resolve, POLL_MS))
    }
  }

  return {
    name: "inngest",
    routes: [{ hosts: [INNGEST_HOST], upstream: url }],
    env: { INNGEST_DEV: "1", INNGEST_BASE_URL: `http://${INNGEST_HOST}` },
    attach(attached) {
      proxy = attached
    },
    settle,
    state: () => ({ runs }),
    async reset() {
      runs = []
    },
    async close() {
      await owned?.stop()
    },
  }
}

/**
 * What `danwo matrix` does to an event send: the dev server down, a send whose answer is lost
 * after the event was accepted (an app that retries sends it twice), and a slow one.
 */
export function inngestOutboundFaults(call: OutboundCall): readonly OutboundFault[] {
  if (call.method !== "POST" || !call.path.startsWith("/e/")) return []

  return [
    { kind: "status", status: 500, body: '{"error":"internal error"}' },
    { kind: "reset-after" },
    { kind: "delay", ms: 3_000 },
  ]
}
