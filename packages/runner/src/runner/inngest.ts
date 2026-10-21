/**
 * Inngest as a service: the apps send events to `inngest.danwo.test`, which the proxy routes to an
 * Inngest dev server (started here, or one already running), so every event a test causes is a
 * call the flight record shows and `danwo matrix` can fault. `settle()` waits until the function
 * runs those events triggered have finished, so an invariant reads what the background jobs wrote,
 * and the record keeps each run's function, status and duration.
 */
import { createServer } from "node:net"

import {
  forwardTo,
  type Handler,
  type OutboundCall,
  type OutboundFault,
  type Proxy,
} from "@danwo/proxy"

import { type OwnedChild, spawnOwned } from "../support/children.ts"
import { cronDue } from "./cron.ts"
import {
  invokeFunction,
  type RegisteredFunction,
  registeredFunctions,
  runTriggers,
} from "./inngest-dev-api.ts"
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
  /**
   * Seconds between the attempts of a failed step, for a dev server danwo starts; default 1, so a
   * retry lands within a test rather than after Inngest's backoff of up to minutes.
   */
  readonly retryIntervalSeconds?: number
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
  /** When it started, as a time in ms; `Date.now()` when the dev server did not say. */
  readonly startedAt: number
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
    startedAt: Number.isNaN(started) ? Date.now() : started,
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
async function listeners(registry: Registry): Promise<((name: string) => boolean) | undefined> {
  const patterns = (await registry())?.flatMap((fn) => fn.events)

  if (patterns === undefined || patterns.length === 0) return undefined

  return (name) => patterns.some((pattern) => triggeredBy(pattern, name))
}

/** The dev server's registered functions, asked for once, when first needed. */
type Registry = () => Promise<readonly RegisteredFunction[] | undefined>

function registryOf(url: string): Registry {
  let asked: Promise<RegisteredFunction[] | undefined> | undefined

  return () => (asked ??= registeredFunctions(url))
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
function unheardEvents(registry: Registry) {
  const unheard = new Set<string>()
  let listening: Promise<((name: string) => boolean) | undefined> | undefined

  return async (sent: readonly SentEvent[], listed: readonly ListedRun[]) => {
    const runless = sent.filter(({ id }) => !listed.some(({ run }) => run.event === id))

    if (runless.length === 0) return unheard

    listening ??= listeners(registry)

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

/** A port nothing listens on yet. */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()

    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()

      server.close(() => resolve(typeof address === "object" && address ? address.port : 0))
    })
  })
}

/**
 * The `inngest-cli dev` command for a dev server at `url`. Besides its own port, the dev server
 * listens on three more for its connect gateway, which default to fixed ports: each gets a free
 * one, so every worker of a run can start a dev server of its own.
 */
export async function devServerCommand(options: InngestOptions, url: string): Promise<string> {
  const port = new URL(url).port || "8288"
  const [gateway, gatewayGrpc, executorGrpc] = await Promise.all([
    freePort(),
    freePort(),
    freePort(),
  ])

  return [
    "npx --yes inngest-cli dev --no-discovery",
    `--port ${port}`,
    `--connect-gateway-port ${gateway}`,
    `--connect-gateway-grpc-port ${gatewayGrpc}`,
    `--connect-executor-grpc-port ${executorGrpc}`,
    `--retry-interval ${options.retryIntervalSeconds ?? 1}`,
    ...(options.apps ?? []).map((app) => `-u ${app}`),
  ].join(" ")
}

/** Starts the dev server when asked, and waits for it to answer. */
async function startDevServer(
  options: InngestOptions,
  url: string,
): Promise<OwnedChild | undefined> {
  if (options.start === undefined || options.start === false) return undefined

  const command =
    typeof options.start === "string" ? options.start : await devServerCommand(options, url)
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
 * run first showed, `checkpoints` when each run last checkpointed. A run the SDK checkpoints itself,
 * and an event whose run the dev server doesn't list yet, also count as going while an app's call
 * through the proxy is still open (`busy`): a first step that waits ten seconds on a provider sends
 * no checkpoint meanwhile, and the dev server lists its run only once that step is over.
 */
function stillWaiting(
  events: readonly string[],
  listed: readonly ListedRun[],
  firstSeen: ReadonlyMap<string, number>,
  checkpoints: ReadonlyMap<string, number>,
  unheard: ReadonlySet<string> = new Set(),
  busy = false,
): boolean {
  const now = Date.now()
  const going = ({ run, ended }: ListedRun) =>
    !DONE.has(run.status) ||
    (!ended &&
      (busy ||
        now - (checkpoints.get(run.runId) ?? firstSeen.get(run.runId) ?? now) <
          CHECKPOINT_QUIET_MS))

  return events.some((event) => {
    const own = listed.filter(({ run }) => run.event === event)

    if (own.length > 0) return own.some(going)

    return !unheard.has(event) && (busy || now - (firstSeen.get(event) ?? now) < NO_RUNS_MS)
  })
}

/** How much earlier than a moment noted here the dev server may have queued a run, by its clock. */
const CLOCK_SLACK_MS = 1_000

/** Runs of one function that settling expects although no app's event started them. */
interface ExpectedRuns {
  readonly functionId: string
  /** They were queued after this, give or take `CLOCK_SLACK_MS`. */
  readonly since: number
  readonly count: number
  /** When settling began to expect them: it waits `NO_RUNS_MS` from here for them to show. */
  readonly patienceFrom: number
}

function sameRuns(a: readonly ExpectedRuns[], b: readonly ExpectedRuns[]): boolean {
  const key = (runs: readonly ExpectedRuns[]) =>
    runs.map((r) => `${r.functionId} ${r.since} ${r.count}`).join("\n")

  return key(a) === key(b)
}

/**
 * The `onFailure` handler runs that `listed`'s failed runs start: one per failed run of a function
 * with a handler, queued after the first of them started. The dev server starts a handler with its
 * own `inngest/function.failed` event, which no app sends. `failedAt` notes when settling first saw
 * each run failed, which is when it starts to wait for the handler.
 */
async function failureHandlers(
  registry: Registry,
  listed: readonly ListedRun[],
  failedAt: Map<string, number>,
): Promise<ExpectedRuns[]> {
  const failed = listed.filter(({ run }) => run.status === "failed")

  if (failed.length === 0) return []

  const handlerOf = new Map((await registry())?.map((fn) => [fn.id, fn.failureHandler]))
  const byHandler = new Map<string, ListedRun[]>()

  for (const entry of failed) {
    const handler = handlerOf.get(entry.run.functionId)

    if (handler === undefined) continue
    if (!failedAt.has(entry.run.runId)) failedAt.set(entry.run.runId, Date.now())
    byHandler.set(handler, [...(byHandler.get(handler) ?? []), entry])
  }

  return [...byHandler].map(([functionId, runs]) => ({
    functionId,
    since: Math.min(...runs.map((entry) => entry.startedAt)) - CLOCK_SLACK_MS,
    count: runs.length,
    patienceFrom: Math.min(...runs.map((entry) => failedAt.get(entry.run.runId) ?? Date.now())),
  }))
}

/** The events the dev server started `expected`'s runs with, one per run it has queued so far. */
function startedBy(url: string, expected: ExpectedRuns): Promise<string[]> {
  return runTriggers(url, expected.functionId, expected.since)
}

/**
 * `listed`'s runs, each named by its function's slug: the dev server lists a run by its own id for
 * the function.
 */
async function named(registry: Registry, listed: readonly ListedRun[]): Promise<InngestRun[]> {
  const functions = listed.length > 0 ? await registry() : undefined
  const slugs = new Map(functions?.map((fn) => [fn.id, fn.slug]))

  return listed.map(({ run }) => ({
    ...run,
    functionId: slugs.get(run.functionId) || run.functionId,
  }))
}

/** `event` with its `ts` moved `ms` earlier, when it has one. */
function earlier(event: unknown, ms: number): unknown {
  const ts = fieldOf(event, "ts")

  return typeof ts === "number" && typeof event === "object" ? { ...event, ts: ts - ms } : event
}

/**
 * A handler that forwards to the dev server, with every event's `ts` put back on real time. After
 * `time.travel`, an app's SDK stamps the events it sends with its own clock, days ahead; the dev
 * server runs on the real one and would schedule their runs for that day, so they never start.
 */
/** The header the SDK seeds the ids of the events in one send with: `<ms>,<entropy>`. */
const EVENT_ID_SEED = "x-inngest-event-id-seed"

function onRealTime(upstream: string, ahead: () => number): Handler {
  const forward = forwardTo(upstream)

  return async (request) => {
    const ms = ahead()

    if (ms === 0 || request.method !== "POST" || !new URL(request.url).pathname.startsWith("/e/"))
      return forward(request)

    const text = await request.text()
    const headers = new Headers(request.headers)
    const [seededAt, entropy] = (headers.get(EVENT_ID_SEED) ?? "").split(",")

    /* The SDK seeds the events' ids with the time it sent them at, on the same clock. */
    if (seededAt && entropy) headers.set(EVENT_ID_SEED, `${Number(seededAt) - ms},${entropy}`)

    const resent = (body: string) =>
      forward(new Request(request.url, { method: "POST", headers, body }))
    let events: unknown

    try {
      events = JSON.parse(text)
    } catch {
      return resent(text)
    }

    return resent(
      JSON.stringify(
        Array.isArray(events) ? events.map((one) => earlier(one, ms)) : earlier(events, ms),
      ),
    )
  }
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
  /** Runs started since the last reset that no app's event started: cron functions travel invoked. */
  let expected: ExpectedRuns[] = []

  /**
   * After the apps' clocks have moved `ms` ahead, runs each cron function that fell due on the
   * way, once, at the new time, as a dev server left asleep runs its cron functions when it wakes.
   */
  const travel = async (ms: number) => {
    const to = Date.now() + (proxy?.clock.offset() ?? ms)
    const due = ((await registeredFunctions(url)) ?? []).filter((fn) =>
      fn.crons.some((cron) => cronDue(cron, to - ms, to)),
    )

    for (const fn of due) {
      const since = Date.now() - CLOCK_SLACK_MS

      if (await invokeFunction(url, fn.slug))
        expected.push({ functionId: fn.id, since, count: 1, patienceFrom: since })
    }
  }

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

  /** Whether an app's own call through the proxy is still waiting for its answer. */
  const appCallOpen = () =>
    (proxy?.exchanges() ?? []).some(
      (e) => e.client === "server" && e.status === null && !e.aborted && e.stream !== true,
    )

  /**
   * Waits until every event sent so far has finished its runs, the ones those runs send included:
   * the sent events are read again on every poll, and each event gets its own time to show runs.
   * A run listed as finished with no end time is one the SDK checkpoints itself, and counts as
   * finished once it has sent no checkpoint for a while and no app's call through the proxy is
   * still waiting for its answer. An event no registered function listens
   * to is not given that time: the dev server is asked, once, when such an event first shows.
   * Runs no app's event started (a cron function a time travel invoked) are found through the
   * events the dev server started them with, and waited for the same way.
   */
  const settle = async () => {
    const deadline = Date.now() + (options.settleTimeoutMs ?? 30_000)
    const firstSeen = new Map<string, number>()
    const registry = registryOf(url)
    const unheard = unheardEvents(registry)
    const failedAt = new Map<string, number>()
    let handlers: ExpectedRuns[] = []

    for (;;) {
      const sent = sentEvents()
      const wanted = [...expected, ...handlers]
      const found = await Promise.all(wanted.map((some) => startedBy(url, some)))
      const events = [...new Set([...sent.map(({ id }) => id), ...found.flat()])]

      for (const { id, at } of sent) if (!firstSeen.has(id)) firstSeen.set(id, at)
      markSeen(firstSeen, events)

      const listed = (await Promise.all(events.map((event) => runsOf(url, event)))).flat()

      markSeen(
        firstSeen,
        listed.map(({ run }) => run.runId),
      )
      runs = await named(registry, listed)

      const nobody = await unheard(sent, listed)
      const before = handlers

      handlers = await failureHandlers(registry, listed, failedAt)

      const missing =
        !sameRuns(before, handlers) ||
        wanted.some(
          (some, n) =>
            (found[n]?.length ?? 0) < some.count && Date.now() - some.patienceFrom < NO_RUNS_MS,
        )

      if (
        !missing &&
        !stillWaiting(events, listed, firstSeen, lastCheckpoints(), nobody, appCallOpen())
      )
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
    routes: [{ hosts: [INNGEST_HOST], handler: onRealTime(url, () => proxy?.clock.offset() ?? 0) }],
    env: { INNGEST_DEV: "1", INNGEST_BASE_URL: `http://${INNGEST_HOST}` },
    attach(attached) {
      proxy = attached
    },
    settle,
    travel,
    state: () => ({ runs }),
    async reset() {
      runs = []
      expected = []
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
