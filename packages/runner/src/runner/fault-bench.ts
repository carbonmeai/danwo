/**
 * Faults armed by name (from a live session, a test, or a matrix trial), in the words `danwo
 * matrix` reports them:
 * `status 500 on POST api.stripe.com/v1/checkout/sessions`, `reset-after on POST …`,
 * `duplicate on webhook checkout.session.completed`, `stale 3600s on google webhook …`. An armed
 * fault fires once, on the next matching call or delivery (or the n-th, with a ` #n` suffix).
 */
import { routeOf, type RunWebhooks, webhookSources } from "@danwo/core"
import type { WebhookFault } from "@danwo/emulators"
import type { OutboundCall, OutboundFault, Proxy } from "@danwo/proxy"

import { defaultOutboundFaults } from "./faults.ts"

/** An outbound fault as it is named; a status gets its provider's error body when it fires. */
type NamedOutboundFault =
  | { readonly kind: "status"; readonly status: number }
  | { readonly kind: "reset" }
  | { readonly kind: "reset-after" }
  | { readonly kind: "delay"; readonly ms: number }

export type NamedFault =
  | {
      readonly target: "outbound"
      /** Method, host and path with generated ids folded, as `danwo matrix` names routes. */
      readonly route: string
      readonly fault: NamedOutboundFault
      /** Which matching call it fires on, from 1. */
      readonly nth: number
      readonly label: string
    }
  | {
      readonly target: "webhook"
      readonly service?: string
      readonly topic: string
      readonly fault: WebhookFault
      readonly nth: number
      readonly label: string
    }

const METHODS = /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS) (\S+)$/
const WEBHOOK = /^(?:(\S+) )?webhook (\S+)$/

export const FAULT_FORMS = [
  "status <code> on <METHOD> <host><path>   e.g. status 500 on POST api.stripe.com/v1/checkout/sessions",
  "reset | reset-after | delay <ms>ms on <METHOD> <host><path>",
  "duplicate | forged | delay <ms>ms | stale <seconds>s on [<service> ]webhook <topic>   e.g. duplicate on webhook checkout.session.completed",
  "append #<n> to fault the n-th matching call or delivery instead of the next one",
]

function unknownFault(label: string): Error {
  return new Error(`cannot read the fault "${label}". Write one of:\n${FAULT_FORMS.join("\n")}`)
}

function outboundFault(spec: string, label: string): NamedOutboundFault {
  const status = /^status (\d{3})$/.exec(spec)?.[1]
  const delay = /^delay (\d+)ms$/.exec(spec)?.[1]

  if (status !== undefined) return { kind: "status", status: Number(status) }
  if (delay !== undefined) return { kind: "delay", ms: Number(delay) }
  if (spec === "reset" || spec === "reset-after") return { kind: spec }

  throw unknownFault(label)
}

function webhookFault(spec: string, label: string): WebhookFault {
  const delay = /^delay (\d+)ms$/.exec(spec)?.[1]
  const stale = /^stale (\d+)s$/.exec(spec)?.[1]

  if (delay !== undefined) return { kind: "delay", ms: Number(delay) }
  if (stale !== undefined) return { kind: "stale", seconds: Number(stale) }
  if (spec === "duplicate" || spec === "forged") return { kind: spec }

  throw unknownFault(label)
}

/** Splits `<spec> on <target> #n` into its parts. */
function partsOf(label: string): { spec: string; target: string; nth: number } {
  const trimmed = label.trim()
  const on = trimmed.indexOf(" on ")

  if (on < 0) throw unknownFault(label)

  const nth = /\s#(\d+)$/.exec(trimmed)
  const target = trimmed.slice(on + 4, nth === null ? undefined : nth.index).trim()

  return { spec: trimmed.slice(0, on).trim(), target, nth: nth?.[1] ? Number(nth[1]) : 1 }
}

/** Reads a fault's name into what to arm. */
export function parseFault(label: string): NamedFault {
  const { spec, target, nth } = partsOf(label)
  const webhook = WEBHOOK.exec(target)

  if (webhook?.[2] !== undefined) {
    return {
      target: "webhook",
      ...(webhook[1] !== undefined && { service: webhook[1] }),
      topic: webhook[2],
      fault: webhookFault(spec, label),
      nth,
      label: label.trim(),
    }
  }

  const call = METHODS.exec(target)

  if (call?.[1] === undefined || call[2] === undefined) throw unknownFault(label)

  const slash = call[2].indexOf("/")
  const host = slash < 0 ? call[2] : call[2].slice(0, slash)
  const path = slash < 0 ? "/" : call[2].slice(slash)

  return {
    target: "outbound",
    route: routeOf({ method: call[1], host, path }),
    fault: outboundFault(spec, label),
    nth,
    label: label.trim(),
  }
}

/** The fault to answer `call` with: a status gets the body its provider's SDK expects. */
function concrete(named: NamedOutboundFault, call: OutboundCall): OutboundFault {
  if (named.kind !== "status") return named

  const shaped = defaultOutboundFaults(call).find(
    (fault) => fault.kind === "status" && fault.status === named.status,
  )

  return shaped ?? { kind: "status", status: named.status, body: `danwo fault: ${named.status}` }
}

interface Armed {
  readonly fault: NamedFault
  seen: number
  fired: boolean
}

/** The faults armed on one session's proxy and webhook delivery. */
export class FaultBench {
  private armed: Armed[] = []
  private readonly proxy: Proxy | undefined
  private readonly webhooks: RunWebhooks | undefined

  constructor(proxy: Proxy | undefined, webhooks: RunWebhooks | undefined) {
    this.proxy = proxy
    this.webhooks = webhooks
  }

  /** Arms `label`; throws when the session has nothing it could land on. */
  arm(label: string): NamedFault {
    const fault = parseFault(label)

    if (fault.target === "outbound" && this.proxy === undefined)
      throw new Error("this project's environment has no proxy, so calls cannot be faulted")
    if (fault.target === "webhook") this.dispatchersFor(fault)

    this.armed = [...this.armed, { fault, seen: 0, fired: false }]
    this.install()

    return fault
  }

  clear(): number {
    const count = this.armed.filter((armed) => !armed.fired).length

    this.armed = []
    this.proxy?.setFault(undefined)
    for (const [, dispatcher] of webhookSources(this.webhooks)) dispatcher.setFault(undefined)

    return count
  }

  private dispatchersFor(fault: Extract<NamedFault, { target: "webhook" }>) {
    const sources = webhookSources(this.webhooks)
    const matching = sources.filter(
      ([service]) => fault.service === undefined || service === fault.service,
    )

    if (matching.length === 0) {
      const names = sources.map(([service]) => service ?? "(unnamed)").join(", ")

      throw new Error(
        sources.length === 0
          ? "this project's environment delivers no webhooks"
          : `no webhook service "${fault.service ?? ""}" here; the environment has: ${names}`,
      )
    }

    return matching
  }

  /** The next armed fault whose target `matches`, counting the match toward its `#n`. */
  private take(matches: (fault: NamedFault) => boolean): NamedFault | undefined {
    for (const armed of this.armed) {
      if (armed.fired || !matches(armed.fault)) continue

      armed.seen += 1

      if (armed.seen === armed.fault.nth) {
        armed.fired = true

        return armed.fault
      }
    }

    return undefined
  }

  private install(): void {
    this.proxy?.setFault((call) => {
      const route = routeOf(call)
      const fault = this.take((named) => named.target === "outbound" && named.route === route)

      return fault?.target === "outbound" ? concrete(fault.fault, call) : undefined
    })

    for (const [service, dispatcher] of webhookSources(this.webhooks)) {
      dispatcher.setFault((message) => {
        const fault = this.take(
          (named) =>
            named.target === "webhook" &&
            named.topic === message.topic &&
            (named.service === undefined || named.service === service),
        )

        return fault?.target === "webhook" ? fault.fault : undefined
      })
    }
  }
}
