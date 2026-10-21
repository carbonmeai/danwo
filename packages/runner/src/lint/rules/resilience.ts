/** Resilience rules: what the app did after a provider call failed or was cut off. */
import type { RecordedExchange } from "../../runner/record.ts"
import {
  exchangeEvidence,
  providerOfHost,
  requestHeader,
  responseHeader,
  routeOfExchange,
  timeOf,
} from "../subject.ts"
import type { LintRule, LintSubject, RuleFinding } from "../types.ts"
import { movesStripeMoney } from "./stripe.ts"

/** Whether a call creates something at a provider that dedupes creates by `Idempotency-Key`. */
function idempotentCreate(exchange: RecordedExchange): boolean {
  if (movesStripeMoney(exchange)) return true

  return exchange.method === "POST" && providerOfHost(exchange.host) === "bachs"
}

/** The calls after `call` to the same route, in the order they were made. */
function laterOnRoute(subject: LintSubject, call: RecordedExchange): RecordedExchange[] {
  const route = routeOfExchange(call)
  const after = timeOf(call.startedAt)

  return subject.exchanges.filter(
    (other) =>
      other !== call && routeOfExchange(other) === route && timeOf(other.startedAt) >= after,
  )
}

/**
 * A create the provider carried out but whose answer never arrived (`reset-after`: the side
 * effect happened, the connection dropped), sent again without the first call's key: the provider
 * cannot tell the two apart, so the thing was created twice.
 */
function duplicateCreates(subject: LintSubject): RuleFinding[] {
  return subject.exchanges
    .filter((call) => call.fault === "reset-after" && idempotentCreate(call))
    .flatMap((call) => {
      const key = requestHeader(call, "idempotency-key")
      const again = laterOnRoute(subject, call).find(
        (retry) => key === undefined || requestHeader(retry, "idempotency-key") !== key,
      )

      return again === undefined
        ? []
        : [
            {
              provider: providerOfHost(call.host) ?? "any",
              message: `${routeOfExchange(call)} was sent again after its answer was lost, without the first call's Idempotency-Key: the provider created it twice`,
              evidence: exchangeEvidence(subject, again),
            },
          ]
    })
}

/** Seconds in a `Retry-After` header; dates and junk read as none. */
function retryAfterSeconds(call: RecordedExchange): number | undefined {
  const value = Number(responseHeader(call, "retry-after"))

  return Number.isFinite(value) && value > 0 ? value : undefined
}

/**
 * Whether `other` is `call` sent again: the same `Idempotency-Key`, or with no key the same body.
 * Another request on the same route (a second subscriber's email) is not a retry.
 */
function sameRequest(call: RecordedExchange, other: RecordedExchange): boolean {
  const key = requestHeader(call, "idempotency-key")

  if (key !== undefined) return requestHeader(other, "idempotency-key") === key

  return (other.request?.body ?? null) === (call.request?.body ?? null)
}

/** A call retried before the 429 answer's `Retry-After` allowed. */
function earlyRetries(subject: LintSubject): RuleFinding[] {
  return subject.exchanges
    .filter((call) => call.status === 429 && providerOfHost(call.host) !== undefined)
    .flatMap((call) => {
      const seconds = retryAfterSeconds(call)

      if (seconds === undefined) return []

      const allowed = timeOf(call.startedAt) + (call.durationMs ?? 0) + seconds * 1000
      const retry = laterOnRoute(subject, call).find(
        (other) => sameRequest(call, other) && timeOf(other.startedAt) < allowed,
      )

      return retry === undefined
        ? []
        : [
            {
              provider: providerOfHost(call.host) ?? "any",
              message: `${routeOfExchange(call)} was retried sooner than the ${seconds}s its 429 answer asked for`,
              evidence: exchangeEvidence(subject, retry),
            },
          ]
    })
}

/** Whether a call failed in a way a retry could fix. */
function retryableFailure(call: RecordedExchange): boolean {
  return call.status === 429 || call.status === 503 || call.fault === "reset"
}

/** A read that failed in a retryable way and was never tried again. */
function unretriedReads(subject: LintSubject): RuleFinding[] {
  return subject.exchanges
    .filter(
      (call) =>
        call.method === "GET" &&
        call.origin !== "page" &&
        providerOfHost(call.host) !== undefined &&
        retryableFailure(call) &&
        laterOnRoute(subject, call).length === 0,
    )
    .map((call) => ({
      provider: providerOfHost(call.host) ?? "any",
      message: `${routeOfExchange(call)} failed (${call.status ?? call.fault ?? "no answer"}) and was not tried again`,
      evidence: exchangeEvidence(subject, call),
    }))
}

export const duplicateCreate: LintRule = {
  id: "resilience/duplicate-create",
  severity: "error",
  providers: ["stripe", "bachs"],
  summary:
    "A create was retried after its answer was lost, without the first call's Idempotency-Key.",
  hint: "Reuse the same Idempotency-Key when you retry a call, so the provider returns the first result instead of creating a second one.",
  check: duplicateCreates,
}

export const retryAfterIgnored: LintRule = {
  id: "resilience/retry-after-ignored",
  severity: "warning",
  providers: ["any"],
  summary: "A call was retried sooner than its 429 answer's Retry-After allowed.",
  hint: "Wait at least Retry-After seconds before retrying a rate-limited call; retrying sooner prolongs the limit.",
  check: earlyRetries,
}

export const noRetryOnRead: LintRule = {
  id: "resilience/no-retry-on-read",
  severity: "info",
  providers: ["any"],
  summary: "A provider read failed with 429, 503 or a dropped connection and was not tried again.",
  hint: "Retry reads that fail transiently, with backoff and a cap, before showing an error.",
  check: unretriedReads,
}
