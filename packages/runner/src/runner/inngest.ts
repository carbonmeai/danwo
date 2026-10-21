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
/**
 * How long a run the SDK checkpoints itself must send no checkpoint before `settle()` takes it as
 * finished: the dev server lists such a run as completed, with no end time, while its steps run.
 */
const CHECKPOINT_QUIET_MS = 1_500
const POLL_MS = 150
/** A checkpoint call's path, with the run it belongs to. */
const CHECKPOINT = /^\/v1\/checkpoint\/([^/?]+)/

/** A run as the dev server lists it, and whether the dev server gave it an end time. */
interface ListedRun {
  readonly run: InngestRun
  readonly ended: boolean
}

/** `value`'s field `name`, when `value` is an object. */
function fieldOf(value: unknown, name: string): unknown {
  return typeof value === "object" && value !== null ? Reflect.get(value, name) : undefined
}

/** An event's name, when it has one. */
function nameOf(event: unknown): string | undefined {
  const name = fieldOf(event, "name")

  return typeof name === "string" ? name : undefined
}

/**
 * The names of the events in one recorded send, in the order it sent them: the body is one event
 * or a list of them. A name that cannot be read is undefined.
 */
function eventNames(body: string | null | undefined): (string | undefined)[] {
  try {
    const parsed: unknown = JSON.parse(body ?? "")

    return Array.isArray(parsed) ? parsed.map(nameOf) : [nameOf(parsed)]
  } catch {
    return []
  }
}

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
function runOf(event: string, value: unknown): ListedRun | undefined {
  if (typeof value !== "object" || value === null) return undefined

  const field = (name: string) => {
    const raw: unknown = Reflect.get(value, name)

    return typeof raw === "string" ? raw : ""
  }

  const started = Date.parse(field("run_started_at"))
  const ended = Date.parse(field("ended_at"))

  return {
    run: {
      event,
      runId: field("run_id"),
      functionId: field("function_id"),
      status: field("status").toLowerCase(),
      durationMs: Number.isNaN(started) || Number.isNaN(ended) ? null : ended - started,
    },
    ended: !Number.isNaN(ended),
  }
}

/**
 * What a settle waited for, one line each: every run with its function, status and duration, and
 * each event that triggered none.
 */
function waitedFor(events: readonly string[], runs: readonly InngestRun[]): string[] {
  const ran = runs.map((run) => {
    const took = run.durationMs === null ? "" : ` in ${(run.durationMs / 1000).toFixed(1)} s`

    return `${run.functionId || "a function"} ${run.status}${took}`
  })
  const idle = events
    .filter((event) => !runs.some((run) => run.event === event))
    .map((event) => `event ${event} started no run`)

  return [...ran, ...idle]
}

async function runsOf(url: string, event: string): Promise<ListedRun[]> {
  try {
    const response = await fetch(new URL(`/v1/events/${encodeURIComponent(event)}/runs`, url))
    const body: unknown = await response.json()
    const data = typeof body === "object" && body !== null && "data" in body ? body.data : []

    return Array.isArray(data) ? data.flatMap((run) => runOf(event, run) ?? []) : []
  } catch {
    return []
  }
}

/** The dev server's GraphQL query for what every function it has registered is triggered by. */
const TRIGGERS_QUERY = "{ functions { triggers { type value } } }"

/** The event names (`*` a wildcard) the functions in a `TRIGGERS_QUERY` answer are triggered by. */
function eventTriggers(answer: unknown): string[] | undefined {
  const functions = fieldOf(fieldOf(answer, "data"), "functions")

  if (!Array.isArray(functions)) return undefined

  return functions.flatMap((fn: unknown) => {
    const triggers = fieldOf(fn, "triggers")

    return (Array.isArray(triggers) ? triggers : []).flatMap((trigger: unknown) => {
      const value = fieldOf(trigger, "value")

      return fieldOf(trigger, "type") === "EVENT" && typeof value === "string" ? [value] : []
    })
  })
}

/** Whether `pattern`, an event trigger, starts a run for an event called `name`; `*` is a wildcard. */
function triggeredBy(pattern: string, name: string): boolean {
  if (!pattern.includes("*")) return pattern === name

  const parts = pattern.split("*").map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))

  return new RegExp(`^${parts.join(".*")}$`).test(name)
}

/**
 * Whether an event name can start a run at all, from the triggers of the functions the dev server
 * has registered; undefined when it cannot say (a dev server without the query, no functions
 * registered yet, no answer). A function whose trigger has a condition still counts as listening.
 */
async function listeners(url: string): Promise<((name: string) => boolean) | undefined> {
  try {
    const response = await fetch(new URL("/v0/gql", url), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: TRIGGERS_QUERY }),
      signal: AbortSignal.timeout(1_000),
    })
    const patterns = response.ok ? eventTriggers(await response.json()) : undefined

    if (patterns === undefined || patterns.length === 0) return undefined

    return (name) => patterns.some((pattern) => triggeredBy(pattern, name))
  } catch {
    return undefined
  }
}

/** An event sent through the proxy: the id the dev server gave it, and its name when readable. */
interface SentEvent {
  readonly id: string
  readonly name: string | undefined
}

/**
 * For one settle: the events sent so far that no registered function listens to, given the runs
 * listed. The dev server is asked for its functions once, when an event first shows no run.
 */
function unheardEvents(url: string) {
  const unheard = new Set<string>()
  let listening: Promise<((name: string) => boolean) | undefined> | undefined

  return async (sent: readonly SentEvent[], listed: readonly ListedRun[]) => {
    const runless = sent.filter(({ id }) => !listed.some(({ run }) => run.event === id))

    if (runless.length === 0) return unheard

    listening ??= listeners(url)

    const listened = await listening

    if (listened === undefined) return unheard

    for (const { id, name } of runless) if (name !== undefined && !listened(name)) unheard.add(id)

    return unheard
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

/** Notes when each id first showed, for the ids not seen before. */
function markSeen(firstSeen: Map<string, number>, ids: readonly string[]): void {
  const now = Date.now()

  for (const id of ids) if (!firstSeen.has(id)) firstSeen.set(id, now)
}

/**
 * Whether settling waits on: an event that has shown no runs yet, for a while, unless no function
 * listens to it (`unheard`), or a run that has not finished. `firstSeen` holds when each event and
 * run first showed, `checkpoints` when each run last checkpointed.
 */
function stillWaiting(
  events: readonly string[],
  listed: readonly ListedRun[],
  firstSeen: ReadonlyMap<string, number>,
  checkpoints: ReadonlyMap<string, number>,
  unheard: ReadonlySet<string> = new Set(),
): boolean {
  const now = Date.now()
  const going = ({ run, ended }: ListedRun) =>
    !DONE.has(run.status) ||
    (!ended &&
      now - (checkpoints.get(run.runId) ?? firstSeen.get(run.runId) ?? now) < CHECKPOINT_QUIET_MS)

  return events.some((event) => {
    const own = listed.filter(({ run }) => run.event === event)

    if (own.length > 0) return own.some(going)

    return !unheard.has(event) && now - (firstSeen.get(event) ?? now) < NO_RUNS_MS
  })
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

  /**
   * Events sent through the proxy since the last reset, which clears the proxy's log, each with
   * when it was sent: an event's time to show runs counts from its send, so an earlier one that
   * started none is not waited on again by every later settle.
   */
  const sentEvents = () =>
    (proxy?.exchanges() ?? [])
      .filter((e) => e.host === INNGEST_HOST && e.method === "POST" && e.path.startsWith("/e/"))
      .flatMap((e) => {
        const names = eventNames(e.request?.body)

        return eventIds(e.response?.body).map((id, n) => ({
          id,
          at: Date.parse(e.startedAt),
          name: names[n],
        }))
      })

  /** When each run last checkpointed through the proxy (`/v1/checkpoint/<run id>/...`). */
  const lastCheckpoints = () => {
    const last = new Map<string, number>()

    for (const e of proxy?.exchanges() ?? []) {
      const run = e.host === INNGEST_HOST ? CHECKPOINT.exec(e.path)?.[1] : undefined

      if (run !== undefined) last.set(run, Math.max(last.get(run) ?? 0, Date.parse(e.startedAt)))
    }

    return last
  }

  /**
   * Waits until every event sent so far has finished its runs, the ones those runs send included:
   * the sent events are read again on every poll, and each event gets its own time to show runs.
   * A run listed as finished with no end time is one the SDK checkpoints itself, and counts as
   * finished once it has sent no checkpoint for a while. An event no registered function listens
   * to is not given that time: the dev server is asked, once, when such an event first shows.
   */
  const settle = async () => {
    const deadline = Date.now() + (options.settleTimeoutMs ?? 30_000)
    const firstSeen = new Map<string, number>()
    const unheard = unheardEvents(url)

    for (;;) {
      const sent = sentEvents()
      const events = sent.map(({ id }) => id)

      for (const { id, at } of sent) if (!firstSeen.has(id)) firstSeen.set(id, at)

      const listed = (await Promise.all(events.map((event) => runsOf(url, event)))).flat()

      markSeen(
        firstSeen,
        listed.map(({ run }) => run.runId),
      )
      runs = listed.map(({ run }) => run)

      const nobody = await unheard(sent, listed)

      if (!stillWaiting(events, listed, firstSeen, lastCheckpoints(), nobody))
        return waitedFor(events, runs)
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
