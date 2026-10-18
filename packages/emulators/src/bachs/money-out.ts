/**
 * Money going out: refunds against a payment and payouts to a destination. Both reserve the
 * balance when created and settle a moment later on the emulator's clock, with `refund.*` and
 * `payout.*` events.
 */
import { credit } from "./balance.ts"
import type { BachsContext } from "./context.ts"
import type { Payout, Refund } from "./entities.ts"
import { payoutEventData, refundObject } from "./formatters.ts"
import { iso } from "./helpers.ts"

/** How long a refund or payout takes to settle after it is created. */
export const SETTLE_OUT_MS = 2000

/** A processing refund settles: the payment is refunded, or the reserved balance comes back. */
export function settleRefund(context: BachsContext, refund: Refund): void {
  const { bachs } = context
  const now = iso(context.clock())
  const succeeded = refund.outcome === "success"
  const settled =
    bachs.refunds.change(refund.id, {
      status: succeeded ? "success" : "failed",
      settlesAt: null,
      completedAt: now,
      updatedAt: now,
    }) ?? refund

  if (succeeded) {
    const payment = bachs.payments.get(refund.chargeId)

    if (payment)
      bachs.payments.change(payment.id, {
        refunded: refund.requested,
        status: refund.requested >= payment.amount ? "refunded" : "partially_refunded",
        updatedAt: now,
      })
  } else credit(bachs, refund.currency, refund.requested)

  context.events.emit(succeeded ? "refund.paid" : "refund.failed", refundObject(settled, succeeded))
}

/** A processing payout settles: delivered, or failed with its money back in the balance. */
export function settlePayout(context: BachsContext, payout: Payout): void {
  const { bachs } = context
  const destination = bachs.destinations.get(payout.destinationId)
  const fails = destination?.fails ?? false
  const settled =
    bachs.payouts.change(payout.id, {
      status: fails ? "failed" : "completed",
      failureReason: fails ? "The destination account rejected the transfer" : null,
      settlesAt: null,
      completedAt: iso(context.clock()),
    }) ?? payout

  if (fails) credit(bachs, payout.sourceCurrency, payout.sourceAmount + payout.fee)
  context.events.emit(fails ? "payout.failed" : "payout.paid", payoutEventData(settled))
}
