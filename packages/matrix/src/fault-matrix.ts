import {
  describeWebhookFault,
  type DeliveryAttempt,
  WebhookDispatcher,
  type WebhookFault,
} from "@danwo/emulators"
import type { DataCall, DataProxy } from "@danwo/infra"
import {
  describeOutboundFault,
  type Exchange,
  type OutboundCall,
  type OutboundFault,
  type Proxy,
  type SocketExchange,
} from "@danwo/proxy"
import { Data, Effect, Result } from "effect"

import {
  applyDataFault,
  type DataFaultCatalogue,
  dataCallsOf,
  type DataPlannedFault,
  planDataFaults,
} from "./data-faults.ts"
import type { SetupCaused, SetupSpan } from "./focus.ts"
import { occurrenceOf } from "./occurrence.ts"
import { applySocketFault, planSocketFaults, type SocketPlannedFault } from "./socket-faults.ts"

/**
 * Webhook delivery a run's faults can land on: one dispatcher, or several keyed by service name
 * (`{ stripe, resend }`) so faults and deliveries say which service sent them.
 */
export type RunWebhooks = WebhookDispatcher | Readonly<Record<string, WebhookDispatcher>>

/** A delivery attempt, with the service that made it when the environment names its dispatchers. */
export type ServiceDelivery = DeliveryAttempt & { readonly service?: string }

/** What one run of a journey needs: the proxy, and any webhook delivery, to inject faults into. */
export interface RunEnvironment {
  readonly proxy: Proxy
  /** Absent when no service delivers webhooks: the run then gets outbound faults only. */
  readonly webhooks?: RunWebhooks | undefined
  /** Proxies in front of the app's own database and cache: their calls get data faults. */
  readonly data?: readonly DataProxy[] | undefined
  /** Facts about the run worth showing next to its verdict (e.g. where a replay diverged). */
  notes?(): readonly string[]
  close(): Promise<void>
}

/** One fault, placed on one outbound call, webhook or data call of the clean run. */
export type PlannedFault =
  | {
      readonly target: "outbound"
      /** The call as the clean run made it. */
      readonly call: OutboundCall
      /** Method, host and path with generated ids folded (`POST checkout.stripe.com/checkout/:id/complete`). */
      readonly route: string
      /** Which call to `route` in the clean run, from 0. */
      readonly occurrence: number
      readonly fault: OutboundFault
      readonly label: string
    }
  | {
      readonly target: "webhook"
      /** The dispatcher's name when the environment keys its webhooks by service. */
      readonly service?: string
      readonly topic: string
      /** Which delivery of `topic` in the clean run, from 0. */
      readonly occurrence: number
      readonly fault: WebhookFault
      readonly label: string
    }
  | DataPlannedFault
  | SocketPlannedFault
  | RaceFault

/**
 * A race the run sets up from the browser's side rather than on one call or delivery:
 * - `page`: the app's own request (`POST /checkout`) the page sent, sent twice at once;
 * - `users`: the whole test run by `users` people at once, in separate browsers;
 * - `redirect`: the provider's webhooks delivered before the browser lands back on the app.
 */
export type RaceFault =
  | {
      readonly target: "page"
      /** The app request as `METHOD /path`, ids folded to `:id`. */
      readonly route: string
      /** Which request to `route` in the clean run, from 0. */
      readonly occurrence: number
      readonly label: string
    }
  | { readonly target: "users"; readonly users: number; readonly label: string }
  | {
      readonly target: "redirect"
      /** Which return to the app from another site in the clean run, from 0. */
      readonly occurrence: number
      /**
       * The provider call whose answer redirected the browser back (`POST checkout.stripe.com/…`),
       * and which such return through that method and host, from 0: its answer is held at the
       * proxy. Hosted pages put their own codes in paths, so the route alone does not find it
       * again. Absent when the browser came back by following a link, which is held in the browser.
       */
      readonly via?: { readonly route: string; readonly occurrence: number }
      readonly label: string
    }

export interface RunOutcome {
  /** Null for the clean run. */
  readonly fault: PlannedFault | null
  /**
   * `invalid`: the run's planned fault fired on no call or delivery (the app took another path,
   * say a cached value), so the run says nothing about that fault, pass or fail. `not-judged`: the
   * run could not be judged (it was blocked, the judge could not tell, the browser or model
   * provider failed, or the body broke before its fault could fire), so it says nothing about the
   * fault either; `error` says why.
   */
  readonly status: "passed" | "failed" | "invalid" | "not-judged" | "environment-error"
  readonly error: string | null
  readonly exchanges: readonly Exchange[]
  readonly deliveries: readonly ServiceDelivery[]
  /** The statements and commands the app sent its own database and cache, through data proxies. */
  readonly dataCalls?: readonly DataCall[] | undefined
  /** WebSocket connections through the proxy during the run. */
  readonly sockets?: readonly SocketExchange[] | undefined
  /** The environment's `notes()` after the journey. */
  readonly notes: readonly string[]
  /** Where the run's flight record was kept, when one was. */
  readonly record?: string | undefined
  /** The test file line the run's failure passed through, relative to the project root. */
  readonly source?: { readonly file: string; readonly line: number } | undefined
  /**
   * Where the body broke before it finished, when it did and the run went on to judge it (a
   * faulted trial's invariant does): `body stopped at tests/x.danwo.ts:21: …`.
   */
  readonly stopped?: string | undefined
  /**
   * Whether a race fault (page, users, redirect) was set up: those leave no fault label on a call
   * or delivery, so the run reports it.
   */
  readonly fired?: boolean | undefined
  /**
   * How much of the run came before the test's body (a saved session signing in, fixtures,
   * `beforeEach`): those calls get no faults unless the matrix is asked to include setup.
   */
  readonly setup?: SetupSpan | undefined
  /**
   * Calls, deliveries, statements and sockets of the run that setup set off although they came
   * once the body began (a webhook a sign-in sent, the calls its handler made, the rest of a
   * transaction setup opened), by their place in the run's lists. They are counted where a fault
   * counts the calls it lands on, but get no faults: a trial that skips the setup never makes them.
   */
  readonly caused?: SetupCaused | undefined
}

export interface FaultMatrixResult {
  readonly clean: RunOutcome
  /** Empty when the clean run did not pass: faults are only meaningful on a working journey. */
  readonly runs: readonly RunOutcome[]
  /** How the plan was focused: what it left out and why. Absent when nothing was left out. */
  readonly plan?: PlanSummary | undefined
}

/** What a matrix's plan left out, in counts, for reports and the dashboard. */
export interface PlanSummary {
  /** Faults the whole clean run allowed, setup included. */
  readonly total: number
  readonly planned: number
  readonly skipped: {
    readonly setup: number
    readonly background: number
    readonly repeats: number
    readonly kinds: number
    readonly budget: number
  }
}

export interface FaultMatrixOptions<E extends RunEnvironment> {
  /**
   * Starts a fresh environment: app, emulators, proxy. Called once per run with the run's planned
   * fault, null for the clean run (which may, say, record what faulted runs replay).
   */
  readonly environment: (run: { readonly fault: PlannedFault | null }) => Promise<E>
  /** Drives the app and asserts what must hold; throws when it does not. */
  readonly journey: (env: E) => Promise<void>
  /** Faults to try on each outbound call of the clean run. */
  readonly outboundFaults: (call: OutboundCall) => readonly OutboundFault[]
  /** Faults to try on each webhook the clean run delivered. */
  readonly webhookFaults: readonly WebhookFault[]
  /** Faults to try on each call the app made to its own database or cache (default: none). */
  readonly dataFaults?: DataFaultCatalogue
  /**
   * How many faulted runs at once (default 1). Only for environments that isolate each run (own
   * ports, own database); the clean run always runs alone first. Results keep the plan's order.
   * `danwo matrix` runs trials in parallel across worker processes instead, each with its own
   * environment.
   */
  readonly concurrency?: number
  /**
   * How many times to run a faulted run again while it comes out `invalid` (default 0: report it
   * invalid). Helps when whether the faulted call happens depends on timing.
   */
  readonly rerunInvalid?: number
}

class EnvironmentError extends Data.TaggedError("EnvironmentError")<{ readonly cause: unknown }> {}
class JourneyFailed extends Data.TaggedError("JourneyFailed")<{ readonly cause: unknown }> {}

function message(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

/** A path segment that names one record rather than a route: a uuid, a number, a generated id. */
const GENERATED_SEGMENT = [
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  /^\d+$/,
  /^[a-z]{2,8}_(?:test_|live_)?[A-Za-z0-9]{8,}$/,
  /^(?=.*\d)[A-Za-z0-9_-]{16,}$/,
]

/**
 * A call's route: method, host and path without its query, generated ids folded to `:id`. Faults
 * are placed by route and occurrence rather than by position, so a call another run makes in a
 * different order (a browser's favicon) cannot shift which call a fault lands on.
 */
export function routeOf(call: Pick<OutboundCall, "method" | "host" | "path">): string {
  const path = call.path.split("?")[0] ?? ""
  const folded = path
    .split("/")
    .map((segment) => (GENERATED_SEGMENT.some((rule) => rule.test(segment)) ? ":id" : segment))
    .join("/")

  return `${call.method} ${call.host}${folded}`
}

/** Each webhook dispatcher with its service name (none for a single unnamed dispatcher). */
export function webhookSources(
  webhooks: RunWebhooks | undefined,
): readonly (readonly [string | undefined, WebhookDispatcher])[] {
  if (webhooks === undefined) return []
  if (webhooks instanceof WebhookDispatcher) return [[undefined, webhooks]]

  return Object.entries(webhooks)
}

/** Every dispatcher's delivery attempts, tagged with their service. */
export function deliveriesOf(webhooks: RunWebhooks | undefined): ServiceDelivery[] {
  return webhookSources(webhooks).flatMap(([service, dispatcher]) =>
    dispatcher
      .attempts()
      .map((attempt) => (service === undefined ? attempt : { ...attempt, service })),
  )
}

/** Clears every webhook dispatcher's fault rule. */
export function clearWebhookFaults(webhooks: RunWebhooks | undefined): void {
  for (const [, dispatcher] of webhookSources(webhooks)) dispatcher.setFault(undefined)
}

/**
 * Sets the proxy's, the webhook dispatcher's or the data proxy's fault rule so `planned` fires on
 * its call or delivery.
 */
export function applyFault(
  env: Pick<RunEnvironment, "proxy" | "webhooks" | "data">,
  planned: PlannedFault | null,
): void {
  if (planned?.target === "outbound") {
    const hits = occurrenceOf(routeOf, planned)

    env.proxy.setFault((call) => (hits(call) ? planned.fault : undefined))
  } else if (planned?.target === "webhook") {
    applyWebhookFault(env.webhooks, planned)
  } else if (planned?.target === "data") {
    applyDataFault(env.data, planned)
  } else if (planned?.target === "socket") {
    applySocketFault(env.proxy, planned)
  }
}

function applyWebhookFault(
  webhooks: RunWebhooks | undefined,
  planned: Extract<PlannedFault, { target: "webhook" }>,
): void {
  const source = webhookSources(webhooks).find(([service]) => service === planned.service)

  if (source === undefined) {
    throw new Error(`no webhook dispatcher for ${planned.service ?? "the run"}: ${planned.label}`)
  }

  let seen = 0

  source[1].setFault((msg) =>
    msg.topic === planned.topic && seen++ === planned.occurrence ? planned.fault : undefined,
  )
}

/**
 * Whether the run's planned fault was injected: some exchange or delivery carries a fault label,
 * or, for a race fault, the run says it set the race up.
 */
export function faultFired(outcome: RunOutcome): boolean {
  const { fault } = outcome

  if (fault === null) return true
  if (fault.target === "outbound") return outcome.exchanges.some((item) => item.fault !== null)
  if (fault.target === "webhook") return outcome.deliveries.some((item) => item.fault !== null)
  if (fault.target === "data") return (outcome.dataCalls ?? []).some((item) => item.fault !== null)
  if (fault.target === "socket") return (outcome.sockets ?? []).some((item) => item.fault !== null)

  return outcome.fired === true
}

/** What a fault lands on, in words, for a run whose fault never fired. */
const MISSED: Readonly<Record<PlannedFault["target"], string>> = {
  outbound: "no call",
  webhook: "no delivery",
  data: "no database or cache call",
  socket: "no WebSocket",
  page: "no request",
  users: "no second user",
  redirect: "no redirect with a webhook pending",
}

/**
 * Marks a faulted run whose fault never fired: `not-judged` when its body broke before it reached
 * the fault, else `invalid`. Environment errors and runs that could not be judged stay as they are.
 */
export function checkFaultFired(outcome: RunOutcome): RunOutcome {
  if (
    outcome.status === "environment-error" ||
    outcome.status === "not-judged" ||
    faultFired(outcome)
  )
    return outcome

  return outcome.stopped === undefined ? missed(outcome) : brokeFirst(outcome, outcome.stopped)
}

/** A run whose body broke at `stopped`, before it reached its fault. */
function brokeFirst(outcome: RunOutcome, stopped: string): RunOutcome {
  return {
    ...outcome,
    status: "not-judged",
    error: `not judged: the body broke before the fault point, so ${outcome.fault?.label ?? "the fault"} never fired (${stopped})`,
  }
}

/** A run whose body ran through while its fault matched nothing. */
function missed(outcome: RunOutcome): RunOutcome {
  return {
    ...outcome,
    status: "invalid",
    error: `the fault never fired: ${MISSED[outcome.fault?.target ?? "outbound"]} matched ${outcome.fault?.label ?? "it"} in this run (the body ${outcome.status})${outcome.error ? `: ${outcome.error}` : ""}`,
  }
}

/** Runs the journey once in a fresh environment, with at most one fault. */
function runOnce<E extends RunEnvironment>(
  options: FaultMatrixOptions<E>,
  planned: PlannedFault | null,
): Effect.Effect<RunOutcome> {
  const run = Effect.acquireUseRelease(
    Effect.tryPromise({
      try: () => options.environment({ fault: planned }),
      catch: (cause) => new EnvironmentError({ cause }),
    }),
    (env) =>
      Effect.gen(function* () {
        applyFault(env, planned)
        const journey = yield* Effect.result(
          Effect.tryPromise({
            try: () => options.journey(env),
            catch: (cause) => new JourneyFailed({ cause }),
          }),
        )

        yield* Effect.tryPromise({
          try: () => env.proxy.settled(),
          catch: (cause) => new EnvironmentError({ cause }),
        })
        const outcome: RunOutcome = {
          fault: planned,
          status: Result.isSuccess(journey) ? "passed" : "failed",
          error: Result.isSuccess(journey) ? null : message(journey.failure.cause),
          exchanges: env.proxy.exchanges(),
          deliveries: deliveriesOf(env.webhooks),
          dataCalls: dataCallsOf(env.data),
          sockets: env.proxy.sockets(),
          notes: env.notes?.() ?? [],
        }

        return checkFaultFired(outcome)
      }),
    (env) => Effect.promise(() => env.close().catch(() => undefined)),
  )

  return run.pipe(
    Effect.catchTag("EnvironmentError", (error) =>
      Effect.succeed<RunOutcome>({
        fault: planned,
        status: "environment-error",
        error: message(error.cause),
        exchanges: [],
        deliveries: [],
        notes: [],
      }),
    ),
  )
}

/** Runs a faulted run, again up to `rerunInvalid` times while it comes out invalid. */
function rerunWhileInvalid<E extends RunEnvironment>(
  options: FaultMatrixOptions<E>,
  planned: PlannedFault,
): Effect.Effect<RunOutcome> {
  const attempt = (left: number): Effect.Effect<RunOutcome> =>
    Effect.flatMap(runOnce(options, planned), (outcome) =>
      outcome.status === "invalid" && left > 0 ? attempt(left - 1) : Effect.succeed(outcome),
    )

  return attempt(Math.max(0, Math.floor(options.rerunInvalid ?? 0)))
}

/** Each webhook message's first unfaulted delivery, once per message and service. */
function firstDeliveries(deliveries: readonly ServiceDelivery[]): ServiceDelivery[] {
  const seen = new Set<string>()

  return deliveries.filter((attempt) => {
    const key = `${attempt.service ?? ""}#${attempt.messageId}`
    const first = attempt.attempt === 1 && attempt.fault === null && !seen.has(key)

    if (first) seen.add(key)

    return first
  })
}

function webhookLabel(fault: WebhookFault, attempt: ServiceDelivery, occurrence: number): string {
  const service = attempt.service === undefined ? "" : `${attempt.service} `
  const nth = occurrence > 0 ? ` #${occurrence + 1}` : ""

  return `${describeWebhookFault(fault)} on ${service}webhook ${attempt.topic}${nth}`
}

/**
 * Each webhook message's first delivery in the clean run × each webhook fault. Deliveries in
 * `setupCaused` are counted but get none.
 */
function planWebhookFaults(
  deliveries: readonly ServiceDelivery[],
  webhookFaults: readonly WebhookFault[],
  setupCaused: ReadonlySet<ServiceDelivery> = new Set(),
): PlannedFault[] {
  const occurrences = new Map<string, number>()

  return firstDeliveries(deliveries).flatMap((attempt) => {
    const topic = `${attempt.service ?? ""} ${attempt.topic}`
    const occurrence = occurrences.get(topic) ?? 0

    occurrences.set(topic, occurrence + 1)
    if (setupCaused.has(attempt)) return []

    return webhookFaults.map((fault) => ({
      target: "webhook" as const,
      ...(attempt.service !== undefined && { service: attempt.service }),
      topic: attempt.topic,
      occurrence,
      fault,
      label: webhookLabel(fault, attempt, occurrence),
    }))
  })
}

const READS = new Set(["GET", "HEAD"])

/** How many times in a row the same read must come before it counts as a poll. */
const POLL_MIN_RUN = 3

/**
 * Where each routed call stands in a poll: the same read (GET or HEAD, same route) made at least
 * three times in a row, such as an app asking for a balance every second. `first` starts one,
 * `repeat` continues it, `none` is any other call. Two reads in a row are not a poll: an app that
 * fetches signing keys at sign-in and again for an API call does two different things.
 */
export function pollPositions(
  calls: readonly Pick<OutboundCall, "method" | "host" | "path">[],
): ("first" | "repeat" | "none")[] {
  const routes = calls.map((call) => (READS.has(call.method) ? routeOf(call) : undefined))
  const runs = runLengths(routes)

  return routes.map((route, index) => {
    if (route === undefined || (runs[index] ?? 0) < POLL_MIN_RUN) return "none"

    return routes[index - 1] === route ? "repeat" : "first"
  })
}

/** For each position, the length of the run of equal, defined routes it belongs to. */
function runLengths(routes: readonly (string | undefined)[]): number[] {
  const lengths: number[] = []
  let start = 0

  for (let index = 1; index <= routes.length; index++) {
    if (index < routes.length && routes[index] !== undefined && routes[index] === routes[start])
      continue

    for (let at = start; at < index; at++) lengths.push(index - start)
    start = index
  }

  return lengths
}

/**
 * Turns a clean run into a fault plan: every routed call × each outbound fault, every webhook
 * delivered (first attempt, per topic occurrence) × each webhook fault, and every call to the
 * app's own database or cache × each data fault. A poll gets faults on its first call only: how
 * many times it repeats depends on timing, so a fault on a later repeat may fall on a call the
 * next run never makes. What setup set off (`clean.caused`) is counted but gets no faults.
 */
export function planFaults(
  clean: RunOutcome,
  outboundFaults: FaultMatrixOptions<RunEnvironment>["outboundFaults"],
  webhookFaults: readonly WebhookFault[],
  dataFaults?: DataFaultCatalogue,
): PlannedFault[] {
  const plan: PlannedFault[] = []
  const caused = causedItems(clean)
  const routed = clean.exchanges.filter((e) => e.disposition === "routed")
  const polls = pollPositions(routed)
  const routeCounts = new Map<string, number>()

  routed.forEach((exchange, index) => {
    const call = { host: exchange.host, method: exchange.method, path: exchange.path, index }
    const route = routeOf(call)
    const occurrence = routeCounts.get(route) ?? 0
    const nth = occurrence > 0 ? ` #${occurrence + 1}` : ""
    const poll = polls[index] === "first" ? " (poll)" : ""

    routeCounts.set(route, occurrence + 1)
    if (polls[index] === "repeat" || caused.exchanges.has(exchange)) return

    for (const fault of outboundFaults(call))
      plan.push({
        target: "outbound",
        call,
        route,
        occurrence,
        fault,
        label: `${describeOutboundFault(fault)} on ${route}${nth}${poll}`,
      })
  })

  plan.push(...planWebhookFaults(clean.deliveries, webhookFaults, caused.deliveries))
  if (dataFaults !== undefined)
    plan.push(...planDataFaults(clean.dataCalls ?? [], dataFaults, caused.data))
  plan.push(...planSocketFaults(clean.sockets ?? [], caused.sockets))

  return plan
}

/** The items at `at` in `items`, as a set of the items themselves. */
function pick<T>(items: readonly T[] | undefined, at: readonly number[] | undefined): Set<T> {
  return new Set((at ?? []).flatMap((index) => items?.[index] ?? []))
}

/** The run's items setup set off (`outcome.caused`), as sets of the items themselves. */
function causedItems(outcome: RunOutcome) {
  const { caused } = outcome

  return {
    exchanges: pick(outcome.exchanges, caused?.exchanges),
    deliveries: pick(outcome.deliveries, caused?.deliveries),
    data: pick(outcome.dataCalls, caused?.data),
    sockets: pick(outcome.sockets, caused?.sockets),
  }
}

/**
 * Runs the journey clean, plans one fault per outbound call and webhook it made, then runs the
 * journey once per fault, each in a fresh environment. A run passes when the journey's own
 * assertions hold despite the fault.
 */
export function runFaultMatrix<E extends RunEnvironment>(
  options: FaultMatrixOptions<E>,
): Promise<FaultMatrixResult> {
  const program = Effect.gen(function* () {
    const clean = yield* runOnce(options, null)

    if (clean.status !== "passed") return { clean, runs: [] }
    const plan = planFaults(
      clean,
      options.outboundFaults,
      options.webhookFaults,
      options.dataFaults,
    )
    const runs = yield* Effect.forEach(plan, (planned) => rerunWhileInvalid(options, planned), {
      concurrency: Math.max(1, Math.floor(options.concurrency ?? 1)),
    })

    return { clean, runs }
  })

  return Effect.runPromise(program)
}

const STATUS_LABEL: Record<RunOutcome["status"], string> = {
  passed: "PASS",
  failed: "FAIL",
  invalid: "INVALID",
  "not-judged": "NOT JUDGED",
  "environment-error": "ENV ",
}

/** One run's lines in the plain-text report. */
function runLine(r: RunOutcome): string {
  return `${STATUS_LABEL[r.status]}  ${r.fault?.label ?? "clean run"}${r.notes.map((note) => `\n        ${note}`).join("")}${r.error ? `\n        ${r.error}` : ""}${r.record && r.status !== "passed" ? `\n        record: ${r.record}` : ""}`
}

/** A plain-text report: one line per run, then the counts of faulted runs by status. */
export function formatMatrix(result: FaultMatrixResult): string {
  const count = (status: RunOutcome["status"], word: string) => {
    const n = result.runs.filter((r) => r.status === status).length

    return n > 0 ? `${n} ${word}` : ""
  }

  const summary = [
    count("passed", "passed"),
    count("failed", "failed"),
    count("invalid", "invalid (fault never fired)"),
    count("not-judged", "not judged"),
    count("environment-error", "environment errors"),
  ].filter(Boolean)

  return [
    ...[result.clean, ...result.runs].map(runLine),
    ...(summary.length > 0 ? [`faults: ${summary.join(", ")}`] : []),
  ].join("\n")
}
