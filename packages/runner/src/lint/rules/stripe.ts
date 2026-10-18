/** Stripe rules: money-moving calls that must be safe to retry. */
import type { RecordedExchange } from "../../runner/record.ts"
import { exchangeEvidence, pathOf, requestHeader, routeOfExchange } from "../subject.ts"
import type { LintRule, LintSubject, RuleFinding } from "../types.ts"

/** Stripe paths that create or move money; ids are folded to `:id` before matching. */
const MONEY_PATHS = [
  /^\/v1\/payment_intents$/,
  /^\/v1\/payment_intents\/[^/]+\/(confirm|capture)$/,
  /^\/v1\/checkout\/sessions$/,
  /^\/v1\/refunds$/,
  /^\/v1\/transfers$/,
  /^\/v1\/payouts$/,
  /^\/v1\/subscriptions$/,
  /^\/v1\/charges$/,
  /^\/v1\/invoices\/[^/]+\/pay$/,
]

/** Whether a call is a Stripe API POST that moves money. */
export function movesStripeMoney(
  exchange: Pick<RecordedExchange, "method" | "host" | "path">,
): boolean {
  return (
    exchange.method === "POST" &&
    exchange.host === "api.stripe.com" &&
    MONEY_PATHS.some((path) => path.test(pathOf(exchange)))
  )
}

/**
 * The first call to each money route without an `Idempotency-Key`. One finding per route keeps
 * a run that creates ten refunds from reporting ten times.
 */
function missingKeys(subject: LintSubject): RuleFinding[] {
  const reported = new Set<string>()
  const findings: RuleFinding[] = []

  for (const exchange of subject.exchanges) {
    if (!movesStripeMoney(exchange) || exchange.request === undefined) continue
    if (requestHeader(exchange, "idempotency-key") !== undefined) continue

    const route = routeOfExchange(exchange)

    if (reported.has(route)) continue
    reported.add(route)
    findings.push({
      provider: "stripe",
      message: `${route} was sent without an Idempotency-Key`,
      evidence: exchangeEvidence(subject, exchange),
    })
  }

  return findings
}

export const stripeIdempotencyKey: LintRule = {
  id: "stripe/idempotency-key",
  severity: "warning",
  providers: ["stripe"],
  summary: "A Stripe call that moves money was sent without an Idempotency-Key header.",
  hint: "Send a key derived from your own order or attempt id, so a retried request cannot charge, refund or pay out twice.",
  check: missingKeys,
}
