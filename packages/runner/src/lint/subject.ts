/**
 * Reading a run for the lint rules: which provider a call or delivery belongs to, which step it
 * happened in, its headers and query, and what credential it carried.
 */
import { routeOf, type ServiceDelivery } from "@danwo/matrix"

import type { RecordedExchange, RecordedStep } from "../runner/record.ts"
import type { LintEvidence, LintSubject } from "./types.ts"

/** Provider hosts: an exact host, or a suffix after a dot. */
const PROVIDER_HOSTS: readonly (readonly [string, readonly string[]])[] = [
  ["stripe", ["api.stripe.com", "checkout.stripe.com"]],
  ["paystack", ["api.paystack.co", "checkout.paystack.com"]],
  ["flutterwave", ["api.flutterwave.com", "checkout.flutterwave.com"]],
  ["bachs", ["bachs.io"]],
  ["resend", ["api.resend.com"]],
  ["twilio", ["twilio.com"]],
  ["slack", ["slack.com"]],
  ["github", ["github.com"]],
  ["google", ["accounts.google.com", "googleapis.com"]],
  ["microsoft", ["login.microsoftonline.com", "graph.microsoft.com"]],
  ["composio", ["composio.dev"]],
  ["nylas", ["nylas.com"]],
  ["nango", ["nango.dev"]],
  ["unipile", ["unipile.com"]],
  ["pusher", ["pusher.com", "pusherapp.com"]],
  ["novu", ["novu.co"]],
  ["tiptap", ["collab.tiptap.cloud"]],
]

/** The provider a host belongs to, if danwo knows it. */
export function providerOfHost(host: string): string | undefined {
  const name = host.toLowerCase()

  return PROVIDER_HOSTS.find(([, hosts]) =>
    hosts.some((known) => name === known || name.endsWith(`.${known}`)),
  )?.[0]
}

/** Stripe's event names, for a delivery sent by a single unnamed dispatcher. */
const STRIPE_TOPIC = /^(checkout|payment_intent|charge|customer|invoice|refund|payout|transfer)\./

/** The provider that sent a delivery: its service name, else Stripe for Stripe's event names. */
export function providerOfDelivery(delivery: ServiceDelivery): string | undefined {
  if (delivery.service !== undefined) return delivery.service

  return STRIPE_TOPIC.test(delivery.topic) ? "stripe" : undefined
}

/** Every provider the run talked to or heard from. */
export function providersIn(subject: LintSubject): Set<string> {
  const seen = new Set<string>()

  for (const exchange of subject.exchanges) {
    const provider = providerOfHost(exchange.host)

    if (provider !== undefined) seen.add(provider)
  }

  for (const delivery of subject.deliveries) {
    const provider = providerOfDelivery(delivery)

    if (provider !== undefined) seen.add(provider)
  }

  return seen
}

/** A header of a recorded request, by name in any case. */
export function requestHeader(exchange: RecordedExchange, name: string): string | undefined {
  return headerOf(exchange.request?.headers, name)
}

export function responseHeader(exchange: RecordedExchange, name: string): string | undefined {
  return headerOf(exchange.response?.headers, name)
}

function headerOf(
  headers: Readonly<Record<string, string>> | undefined,
  name: string,
): string | undefined {
  const wanted = name.toLowerCase()

  return Object.entries(headers ?? {}).find(([key]) => key.toLowerCase() === wanted)?.[1]
}

/** The query parameters of a call's path. */
export function queryOf(exchange: Pick<RecordedExchange, "path">): URLSearchParams {
  const at = exchange.path.indexOf("?")

  return new URLSearchParams(at === -1 ? "" : exchange.path.slice(at + 1))
}

/** The path without its query. */
export function pathOf(exchange: Pick<RecordedExchange, "path">): string {
  return exchange.path.split("?")[0] ?? ""
}

/** The call's route with generated ids folded, e.g. `POST api.stripe.com/v1/refunds`. */
export function routeOfExchange(exchange: RecordedExchange): string {
  return routeOf(exchange)
}

/** When a call or delivery happened, in milliseconds. */
export function timeOf(iso: string): number {
  return Date.parse(iso)
}

/** The step running at `iso`: the last one that started at or before it. */
export function stepAt(steps: readonly RecordedStep[], iso: string): RecordedStep | undefined {
  const at = timeOf(iso)

  return steps.findLast((step) => timeOf(step.startedAt) <= at)
}

/** Evidence for a call, with the step it happened in. */
export function exchangeEvidence(subject: LintSubject, exchange: RecordedExchange): LintEvidence {
  return {
    exchange: {
      id: exchange.id,
      method: exchange.method,
      host: exchange.host,
      path: pathOf(exchange),
      status: exchange.status,
    },
    ...stepEvidence(stepAt(subject.steps, exchange.startedAt)),
  }
}

/** Evidence for a webhook attempt, with the step it arrived in. */
export function deliveryEvidence(subject: LintSubject, delivery: ServiceDelivery): LintEvidence {
  return {
    delivery: {
      topic: delivery.topic,
      attempt: delivery.attempt,
      status: delivery.status,
      fault: delivery.fault,
    },
    ...stepEvidence(stepAt(subject.steps, sentAtOf(delivery))),
  }
}

/**
 * When a delivery was sent by the wall clock, which lines it up with steps and calls. Its `at` is
 * the emulator's clock, which a test may hold still or move far ahead.
 */
export function sentAtOf(delivery: ServiceDelivery): string {
  return delivery.sentAt ?? delivery.at
}

/** When the run's last step ended: the end of what its body checked. */
export function bodyEnd(subject: LintSubject): number {
  return Math.max(0, ...subject.steps.map((step) => timeOf(step.startedAt) + step.durationMs))
}

function stepEvidence(step: RecordedStep | undefined): Pick<LintEvidence, "step" | "source"> {
  if (step === undefined) return {}

  return {
    step: { index: step.index, label: step.label },
    ...(step.source && { source: step.source }),
  }
}

/** Whether the run's body ran to its end and passed: what the app showed is what the test wanted. */
export function bodyPassed(subject: LintSubject): boolean {
  return subject.status === "passed" && subject.stopped === undefined
}

/** Whether a status is a 2xx answer. */
export function isSuccess(status: number | null): boolean {
  return status !== null && status >= 200 && status < 300
}
