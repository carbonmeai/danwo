/**
 * Race faults: the money bugs that need two things to happen at once, or in an unlucky order. A
 * form sent twice, two people buying the last item, a provider's webhook landing before the
 * customer is back on the app, two webhooks arriving the wrong way round, a provider so slow the
 * app gives up and asks again while its first request still goes through. Like every other
 * fault, each is planned from what the clean run did, and only where it can happen.
 */
import { describeOutboundFault, type OutboundCall } from "@danwo/proxy"

import {
  type PlannedFault,
  routeOf,
  type RunOutcome,
  type ServiceDelivery,
} from "./fault-matrix.ts"

/** What the clean run showed from the browser's side, beyond its calls and deliveries. */
export interface RaceEvidence {
  /** The app's own requests the page sent that change something, as `METHOD /path`, in order. */
  readonly submits: readonly string[]
  /** Each time the browser came back to the app from another site, in order. */
  readonly returns: readonly RaceReturn[]
}

/** One return to the app from another site. */
export interface RaceReturn {
  /** The site it came from, e.g. `checkout.stripe.com`. */
  readonly site: string
  /** The call whose answer redirected it back, as the matrix names routes; absent for a link. */
  readonly via?: string
  /**
   * Whether the browser had sent the site a request that changes something (a payment, a sign-up)
   * before it came back. Absent when it was not watched, which counts as yes.
   */
  readonly acted?: boolean
}

/** A provider call `slow-then-retry` may land on, with who made it. */
export type RaceCall = OutboundCall & { readonly client?: "browser" | "server" | undefined }

/** Which race faults a matrix plans; every one is on unless turned off. */
export interface RacePlanOptions {
  /** What the clean run showed from the browser's side; without it, no page or redirect races. */
  readonly evidence?: RaceEvidence | undefined
  /** The test's `concurrent` option: run it by this many people at once (2 or more). */
  readonly users?: number | undefined
  readonly doubleSubmit?: boolean
  readonly beforeRedirect?: boolean
  readonly webhookOrder?: boolean
  /** Holds a call this long; the calls it applies to. Off when absent. */
  readonly slowThenRetry?:
    | { readonly ms: number; readonly applies: (call: RaceCall) => boolean }
    | undefined
}

/** ` #n` for every occurrence after the first. */
function nth(occurrence: number): string {
  return occurrence > 0 ? ` #${occurrence + 1}` : ""
}

/** Counts each key's occurrences as they come, from 0. */
function counter(): (key: string) => number {
  const seen = new Map<string, number>()

  return (key) => {
    const occurrence = seen.get(key) ?? 0

    seen.set(key, occurrence + 1)

    return occurrence
  }
}

/** `METHOD /path` with ids folded, as the matrix names the app's own requests. */
export function appRoute(method: string, path: string): string {
  return routeOf({ method, host: "", path })
}

/** Each change-making request the page sent to the app, sent twice at once. */
function doubleSubmits(evidence: RaceEvidence): PlannedFault[] {
  const count = counter()

  return evidence.submits.map((route) => {
    const occurrence = count(route)

    return {
      target: "page",
      route,
      occurrence,
      label: `double-submit on ${route}${nth(occurrence)}`,
    }
  })
}

/**
 * Each return to the app from another site after the browser did something there (paid, signed
 * up), with the webhooks delivered before it lands. A return from a site the browser only passed
 * through (a sign-in handshake on the first page) set nothing off to hold back, so it gets no race.
 */
function beforeRedirects(evidence: RaceEvidence, clean: RunOutcome): PlannedFault[] {
  if (clean.deliveries.length === 0) return []

  const bySite = counter()
  const byHost = counter()

  return evidence.returns.flatMap((back, index): PlannedFault[] => {
    const label = `webhooks before redirect from ${back.site}${nth(bySite(back.site))}`
    const via =
      back.via === undefined
        ? undefined
        : { route: back.via, occurrence: byHost(back.via.split("/")[0] ?? back.via) }

    if (back.acted === false) return []

    return [{ target: "redirect", occurrence: index, ...(via !== undefined && { via }), label }]
  })
}

/** Each webhook message's first unfaulted delivery, once per message and service, in order. */
function firstDeliveries(deliveries: readonly ServiceDelivery[]): ServiceDelivery[] {
  const seen = new Set<string>()

  return deliveries.filter((attempt) => {
    const key = `${attempt.service ?? ""}#${attempt.messageId}#${attempt.endpointId}`
    const first = attempt.attempt === 1 && attempt.fault === null && !seen.has(key)

    if (first) seen.add(key)

    return first
  })
}

/**
 * How close by the emulator's clock two webhooks must have been sent to be swapped. Webhooks further
 * apart, such as either side of a time jump, cannot be held for one another within a trial.
 */
const REORDER_WINDOW_MS = 60_000

/** Whether `second` was sent soon enough after `first` for the two to arrive the other way round. */
function closeEnough(first: ServiceDelivery, second: ServiceDelivery): boolean {
  return Date.parse(second.at) - Date.parse(first.at) <= REORDER_WINDOW_MS
}

/**
 * Each pair of webhooks one endpoint got one after the other with different topics, delivered
 * the other way round: the first is held back until the second has been delivered.
 */
function reorders(clean: RunOutcome): PlannedFault[] {
  const firsts = firstDeliveries(clean.deliveries)
  const count = counter()
  const occurrences = firsts.map((d) => count(`${d.service ?? ""} ${d.topic}`))

  return firsts.flatMap((first, at) => {
    const second = firsts.slice(at + 1).find((d) => d.endpointId === first.endpointId)

    if (
      second === undefined ||
      second.topic === first.topic ||
      second.service !== first.service ||
      !closeEnough(first, second)
    )
      return []

    const service = first.service === undefined ? "" : `${first.service} `

    return [
      {
        target: "webhook" as const,
        ...(first.service !== undefined && { service: first.service }),
        topic: first.topic,
        occurrence: occurrences[at] ?? 0,
        fault: { kind: "after" as const, topic: second.topic },
        label: `reorder ${service}webhooks ${first.topic}, ${second.topic}${nth(occurrences[at] ?? 0)}`,
      },
    ]
  })
}

/** Each routed call `slow-then-retry` applies to, held long enough for the app to give up. */
function slowCalls(
  clean: RunOutcome,
  setting: NonNullable<RacePlanOptions["slowThenRetry"]>,
): PlannedFault[] {
  const count = counter()

  return clean.exchanges
    .filter((exchange) => exchange.disposition === "routed")
    .flatMap((exchange, index) => {
      const call = { host: exchange.host, method: exchange.method, path: exchange.path, index }
      const route = routeOf(call)
      const occurrence = count(route)

      if (!setting.applies({ ...call, client: exchange.client })) return []

      const fault = { kind: "slow-then-retry" as const, ms: setting.ms }

      return [
        {
          target: "outbound" as const,
          call,
          route,
          occurrence,
          fault,
          label: `${describeOutboundFault(fault)} on ${route}${nth(occurrence)}`,
        },
      ]
    })
}

/** The race faults a clean run allows, after every one-call fault in the plan. */
export function planRaceFaults(clean: RunOutcome, options: RacePlanOptions = {}): PlannedFault[] {
  const { evidence, users } = options
  const plan: PlannedFault[] = []

  if (evidence !== undefined && options.doubleSubmit !== false)
    plan.push(...doubleSubmits(evidence))
  if (users !== undefined && users >= 2)
    plan.push({ target: "users", users, label: `${users} concurrent users` })
  if (evidence !== undefined && options.beforeRedirect !== false)
    plan.push(...beforeRedirects(evidence, clean))
  if (options.webhookOrder !== false) plan.push(...reorders(clean))
  if (options.slowThenRetry !== undefined) plan.push(...slowCalls(clean, options.slowThenRetry))

  return plan
}
