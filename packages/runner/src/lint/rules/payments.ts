/**
 * Payment rules: an app must confirm a payment with the provider (a verify call, or a signed
 * webhook) before it gives the customer anything; the redirect back from a hosted page proves
 * nothing, since anyone can open that URL.
 */
import type { RecordedExchange } from "../../runner/record.ts"
import {
  bodyEnd,
  bodyPassed,
  exchangeEvidence,
  isSuccess,
  pathOf,
  providerOfDelivery,
  providerOfHost,
  sentAtOf,
  timeOf,
} from "../subject.ts"
import type { LintRule, LintSubject, RuleFinding } from "../types.ts"

/** The hosted payment pages the customer's browser pays on, by provider. */
const CHECKOUT_HOSTS: Readonly<Record<string, string>> = {
  "checkout.stripe.com": "stripe",
  "checkout.paystack.com": "paystack",
  "checkout.flutterwave.com": "flutterwave",
  "checkout.bachs.io": "bachs",
}

/** Server reads that confirm a payment, by provider. */
const CONFIRMING_READS: Readonly<Record<string, readonly RegExp[]>> = {
  stripe: [/^\/v1\/checkout\/sessions\/[^/]+$/, /^\/v1\/payment_intents\/[^/]+$/],
  paystack: [/^\/transaction\/verify\/[^/]+$/, /^\/transaction\/[^/]+$/],
  flutterwave: [/^\/v3\/transactions\/[^/]+\/verify$/, /^\/v3\/transactions\/verify_by_reference$/],
  bachs: [/^\/v1\/checkout-sessions\/[^/]+$/, /^\/v1\/payments\/[^/]+$/],
}

/** The last form the customer submitted on a hosted payment page that the page accepted. */
function lastPayment(subject: LintSubject): RecordedExchange | undefined {
  return subject.exchanges.findLast(
    (call) =>
      call.method === "POST" &&
      CHECKOUT_HOSTS[call.host] !== undefined &&
      call.status !== null &&
      call.status < 400,
  )
}

/**
 * Webhook topics that confirm a payment, by provider. A started subscription confirms a checkout
 * whose first period is a free trial, where nothing is collected yet.
 */
const CONFIRMING_TOPICS: Readonly<Record<string, readonly string[]>> = {
  stripe: [
    "checkout.session.completed",
    "payment_intent.succeeded",
    "charge.succeeded",
    "customer.subscription.created",
  ],
  paystack: ["charge.success", "subscription.create"],
  flutterwave: ["charge.completed"],
  bachs: ["collection.succeeded", "checkout.completed", "customer.subscription.created"],
}

/** A span of the run by the wall clock: after the payment, before the body's last check ended. */
interface Window {
  readonly from: number
  readonly to: number
}

function within(window: Window, iso: string): boolean {
  const at = timeOf(iso)

  return at >= window.from && at <= window.to
}

/** Whether the app read the payment back from the provider's API within the window. */
function verifiedWithin(subject: LintSubject, provider: string, window: Window): boolean {
  const reads = CONFIRMING_READS[provider] ?? []

  return subject.exchanges.some(
    (call) =>
      call.method === "GET" &&
      call.origin !== "page" &&
      providerOfHost(call.host) === provider &&
      within(window, call.startedAt) &&
      reads.some((read) => read.test(pathOf(call))),
  )
}

/** Whether the app took a webhook confirming the payment within the window. */
function heardWithin(subject: LintSubject, provider: string, window: Window): boolean {
  const topics = CONFIRMING_TOPICS[provider] ?? []

  return subject.deliveries.some(
    (delivery) =>
      providerOfDelivery(delivery) === provider &&
      topics.includes(delivery.topic) &&
      isSuccess(delivery.status) &&
      within(window, sentAtOf(delivery)),
  )
}

/**
 * A run whose body passed after a hosted payment, though the app neither verified the payment
 * nor took a webhook for it before the body's checks were done: it must have trusted the
 * redirect. Normally the webhook arrives in time, so this shows in `danwo matrix` trials that
 * delay or drop it.
 */
function unconfirmed(subject: LintSubject): RuleFinding[] {
  const payment = lastPayment(subject)

  if (payment === undefined || !bodyPassed(subject)) return []

  const provider = CHECKOUT_HOSTS[payment.host] ?? "any"
  const window = { from: timeOf(payment.startedAt), to: bodyEnd(subject) }

  if (verifiedWithin(subject, provider, window) || heardWithin(subject, provider, window)) return []

  return [
    {
      provider,
      message: `the test passed after a ${provider} payment that the app never confirmed: no verify call and no webhook came after it`,
      evidence: exchangeEvidence(subject, payment),
    },
  ]
}

/** A Flutterwave payment the app gave value for without verifying the transaction by its API. */
function unverifiedFlutterwave(subject: LintSubject): RuleFinding[] {
  const payment = lastPayment(subject)

  if (payment === undefined || payment.host !== "checkout.flutterwave.com") return []
  if (!bodyPassed(subject)) return []
  if (verifiedWithin(subject, "flutterwave", { from: timeOf(payment.startedAt), to: Infinity }))
    return []

  return [
    {
      provider: "flutterwave",
      message:
        "the test passed after a Flutterwave payment the app never verified with GET /v3/transactions/:id/verify",
      evidence: exchangeEvidence(subject, payment),
    },
  ]
}

export const unconfirmedPayment: LintRule = {
  id: "payments/unconfirmed",
  severity: "error",
  providers: ["stripe", "paystack", "flutterwave", "bachs"],
  summary:
    "The app gave value after a hosted payment without confirming it (no verify call, no webhook): it trusted the redirect.",
  hint: "Fulfil from the provider's signed webhook, or verify the payment with the provider's API on the redirect, before granting anything.",
  check: unconfirmed,
}

export const flutterwaveVerify: LintRule = {
  id: "flutterwave/verify-transaction",
  severity: "warning",
  providers: ["flutterwave"],
  summary:
    "The app gave value for a Flutterwave payment without verifying the transaction by its API.",
  hint: "Call GET /v3/transactions/:id/verify and check its status, amount and currency before giving value, even when a webhook arrived.",
  check: unverifiedFlutterwave,
}
