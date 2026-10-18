/**
 * Work that comes due on the emulator's clock: payments, refunds and payouts settling, checkouts
 * expiring, subscriptions renewing and failed invoices being retried. It runs when a timer set for
 * it fires, and before every request, so it also catches up after a snapshot is restored.
 */
import { renew, retryInvoice } from "./billing.ts"
import { expireCheckout, settlePayment } from "./charges.ts"
import type { BachsContext } from "./context.ts"
import { settlePayout, settleRefund } from "./money-out.ts"
import type { BachsStore } from "./store.ts"

/** One piece of due work and when it is due. */
interface Task {
  readonly at: number
  readonly run: (context: BachsContext) => void
}

/** A due time in milliseconds; never, when there is none. */
function at(time: string | null): number {
  return time === null ? Number.POSITIVE_INFINITY : Date.parse(time)
}

/** Every pending piece of work with a due time. */
function tasks(bachs: BachsStore): Task[] {
  const all: Task[] = []

  for (const checkout of bachs.checkouts.where((c) => c.status === "open"))
    all.push({ at: at(checkout.expiresAt), run: (context) => expireCheckout(context, checkout) })
  for (const payment of bachs.payments.where((p) => p.status === "processing"))
    all.push({ at: at(payment.settlesAt), run: (context) => settlePayment(context, payment) })
  for (const refund of bachs.refunds.where((r) => r.status === "processing"))
    all.push({ at: at(refund.settlesAt), run: (context) => settleRefund(context, refund) })
  for (const payout of bachs.payouts.where((p) => p.status === "processing"))
    all.push({ at: at(payout.settlesAt), run: (context) => settlePayout(context, payout) })
  for (const subscription of bachs.subscriptions.where(
    (s) => s.status === "trialing" || s.status === "active",
  ))
    all.push({ at: at(subscription.nextBilledAt), run: (context) => renew(context, subscription) })
  for (const invoice of bachs.invoices.where((i) => i.status === "open"))
    all.push({
      at: at(invoice.nextPaymentAttempt),
      run: (context) => retryInvoice(context, invoice),
    })

  return all
}

/** At most this many pieces of work run in one pass, so a bad loop cannot hang the emulator. */
const MAX_PER_PASS = 1000

/** Runs every piece of work due by now, earliest first, until none is left. */
export function runDue(context: BachsContext): void {
  const now = context.clock().getTime()

  for (let done = 0; done < MAX_PER_PASS; done++) {
    const next = tasks(context.bachs)
      .filter((task) => task.at <= now)
      .toSorted((a, b) => a.at - b.at)[0]

    if (!next) return

    next.run(context)
  }
}
