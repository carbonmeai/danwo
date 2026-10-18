/** Webhook rules: how the app answered the deliveries providers sent it. */
import type { ServiceDelivery } from "@danwo/matrix"

import { deliveryEvidence, isSuccess, providerOfDelivery } from "../subject.ts"
import type { LintRule, LintSubject, RuleFinding } from "../types.ts"

/** Providers whose signatures cover a timestamp, so an old delivery can be told apart. */
const TIMESTAMPED = new Set(["stripe", "slack", "resend", "bachs", "google"])

function finding(subject: LintSubject, delivery: ServiceDelivery, message: string): RuleFinding {
  return {
    provider: providerOfDelivery(delivery) ?? "any",
    message,
    evidence: deliveryEvidence(subject, delivery),
  }
}

/**
 * A copy signed with the wrong secret, answered 2xx. Only `danwo matrix` sends such copies (its
 * `forged` fault), so this rule speaks only about trials that did: a copy the app took is proof
 * it does not check signatures.
 */
function acceptedForged(subject: LintSubject): RuleFinding[] {
  return subject.deliveries
    .filter((delivery) => delivery.fault === "forged" && isSuccess(delivery.status))
    .map((delivery) =>
      finding(
        subject,
        delivery,
        `the app answered ${delivery.status} to a ${delivery.topic} webhook signed with the wrong secret`,
      ),
    )
}

/** An attempt signed long ago, answered 2xx, from a provider whose signature dates it. */
function acceptedStale(subject: LintSubject): RuleFinding[] {
  return subject.deliveries
    .filter(
      (delivery) =>
        delivery.fault?.startsWith("stale") === true &&
        isSuccess(delivery.status) &&
        TIMESTAMPED.has(providerOfDelivery(delivery) ?? ""),
    )
    .map((delivery) =>
      finding(
        subject,
        delivery,
        `the app accepted a ${delivery.topic} webhook whose signature is ${delivery.fault?.slice(6) ?? ""} old`,
      ),
    )
}

/** An attempt the provider gave up waiting on. */
function answeredSlowly(subject: LintSubject): RuleFinding[] {
  return subject.deliveries
    .filter(
      (delivery) => delivery.status === null && /time(d)? ?out|abort/i.test(delivery.error ?? ""),
    )
    .map((delivery) =>
      finding(
        subject,
        delivery,
        `the app did not answer a ${delivery.topic} webhook before the provider timed out (${delivery.durationMs} ms)`,
      ),
    )
}

/** Whether an attempt was a genuine, correctly signed delivery (a duplicate or late one is too). */
function genuine(delivery: ServiceDelivery): boolean {
  return (
    delivery.fault === null || delivery.fault === "duplicate" || delivery.fault.startsWith("delay")
  )
}

/** Whether the run had a fault anywhere: a 5xx answer under a fault may be the app being careful. */
function faulted(subject: LintSubject): boolean {
  return (
    (subject.run.kind === "matrix" && subject.run.fault !== null) ||
    subject.exchanges.some((exchange) => exchange.fault !== null)
  )
}

/**
 * A genuine delivery the app refused: any 4xx, which tells the provider never to retry, and a
 * 5xx in a run without faults, where nothing could have stopped the app handling it.
 */
function rejectedValid(subject: LintSubject): RuleFinding[] {
  const clean = !faulted(subject)

  return subject.deliveries
    .filter((delivery) => genuine(delivery) && delivery.status !== null)
    .filter((delivery) => {
      const status = delivery.status ?? 0

      return (status >= 400 && status < 500) || (clean && status >= 500)
    })
    .map((delivery) =>
      finding(
        subject,
        delivery,
        `the app answered ${delivery.status} to a correctly signed ${delivery.topic} webhook`,
      ),
    )
}

export const acceptsForgedWebhooks: LintRule = {
  id: "webhooks/accepts-forged",
  severity: "error",
  providers: ["any"],
  summary: "The app accepted a webhook signed with the wrong secret (seen in danwo matrix trials).",
  hint: "Verify every webhook's signature with the provider's signing secret before acting on it, and answer 400 when it does not match.",
  check: acceptedForged,
}

export const acceptsStaleWebhooks: LintRule = {
  id: "webhooks/accepts-stale",
  severity: "warning",
  providers: ["stripe", "slack", "resend", "bachs", "google"],
  summary: "The app accepted a webhook whose signed timestamp was too old to be fresh.",
  hint: "Check the signature's timestamp against a tolerance (Stripe's libraries use 5 minutes), so a captured delivery cannot be replayed later.",
  check: acceptedStale,
}

export const slowWebhookAnswer: LintRule = {
  id: "webhooks/slow-answer",
  severity: "warning",
  providers: ["any"],
  summary: "The app took longer to answer a webhook than the provider waits.",
  hint: "Answer 2xx as soon as the delivery is stored, and do the slow work afterwards, so the provider does not retry a delivery you handled.",
  check: answeredSlowly,
}

export const rejectsValidWebhooks: LintRule = {
  id: "webhooks/rejects-valid",
  severity: "warning",
  providers: ["any"],
  summary:
    "The app refused a correctly signed webhook (any 4xx, or a 5xx in a run without faults).",
  hint: "Answer 2xx to deliveries you have stored, including duplicates you skip; reserve 4xx for bad signatures, since providers do not retry 4xx answers.",
  check: rejectedValid,
}
