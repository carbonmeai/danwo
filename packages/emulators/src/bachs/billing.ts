/**
 * Subscriptions over time: one starts when a recurring checkout completes, renews at the end of
 * each period by charging the saved card off-session, and on a failed charge goes `past_due`, is
 * retried 1, 3 and 5 days apart with a recovery email each time, and is canceled (or marked unpaid)
 * when the retries run out.
 */
import { credit } from "./balance.ts"
import { cardFailure } from "./cards.ts"
import { collectionData } from "./collection.ts"
import type { BachsContext } from "./context.ts"
import type {
  Cadence,
  CheckoutSession,
  Invoice,
  Payment,
  SavedCard,
  Subscription,
} from "./entities.ts"
import { invoiceObject, subscriptionObject } from "./formatters.ts"
import { bachsId, CHECKOUT_ORIGIN, hex, iso, later } from "./helpers.ts"
import { cardMethod, payerOf, paymentRecord } from "./payment-record.ts"

const DAY = 24 * 60 * 60 * 1000

/** How long after each failed charge the next retry comes: 1 day, then 3, then 5. */
const RETRY_DELAYS_MS = [DAY, 3 * DAY, 5 * DAY]

/** `date` moved on by `cadence`, `times` over. */
function addCadence(date: Date, cadence: Cadence, times = 1): Date {
  const next = new Date(date)
  const count = cadence.frequency * times

  if (cadence.interval === "day") next.setUTCDate(next.getUTCDate() + count)
  if (cadence.interval === "week") next.setUTCDate(next.getUTCDate() + 7 * count)
  if (cadence.interval === "month") next.setUTCMonth(next.getUTCMonth() + count)
  if (cadence.interval === "year") next.setUTCFullYear(next.getUTCFullYear() + count)

  return next
}

/** Sends `customer.subscription.<change>` with the subscription as it is now. */
export function announce(
  context: BachsContext,
  change: "created" | "updated" | "deleted",
  subscription: Subscription,
): void {
  context.events.emit(
    `customer.subscription.${change}`,
    subscriptionObject(subscription, context.bachs),
  )
}

function update(
  context: BachsContext,
  subscription: Subscription,
  changes: Partial<Subscription>,
): Subscription {
  return context.bachs.subscriptions.change(subscription.id, changes) ?? subscription
}

/** What a subscription checkout bought: its recurring line and product, cadence and customer. */
function recurringPurchase(context: BachsContext, checkout: CheckoutSession) {
  const line = checkout.lines.find((item) => item.recurring)
  const product = line?.productId ? context.bachs.products.get(line.productId) : undefined
  const cycle = product?.billingCycle

  if (!line || !product || !cycle || !checkout.customerId)
    throw new Error("not a subscription checkout")

  return { line, product, cycle, customerId: checkout.customerId }
}

/** The subscription a checkout's recurring line becomes, before it is stored. */
function draftSubscription(
  context: BachsContext,
  checkout: CheckoutSession,
  card: SavedCard,
): Subscription {
  const { line, product, cycle, customerId } = recurringPurchase(context, checkout)
  const now = context.clock()
  const trialEnd = product.trialPeriod ? addCadence(now, product.trialPeriod) : null
  const periodEnd = trialEnd ?? addCadence(now, cycle)

  return {
    id: bachsId("sub", 12),
    itemId: bachsId("il", 10),
    customerId,
    productId: product.id,
    paymentMethodId: card.id,
    status: trialEnd ? "trialing" : "active",
    currency: checkout.currency,
    unitAmount: line.price.amount ?? checkout.chosenAmount ?? 0,
    priceType: line.price.type,
    billingCycle: cycle,
    seats: line.quantity,
    periodStart: iso(now),
    periodEnd: iso(periodEnd),
    previouslyBilledAt: trialEnd ? null : iso(now),
    nextBilledAt: iso(periodEnd),
    trialEnd: trialEnd ? iso(trialEnd) : null,
    cancelAtPeriodEnd: false,
    canceledAt: null,
    cancelReason: null,
    pendingProration: 0,
    metadata: { ...checkout.metadata, checkout_id: checkout.id },
    createdAt: iso(now),
  }
}

/**
 * Starts the subscription a completed recurring checkout bought. Without a trial, `payment` paid
 * its first cycle, recorded on a paid invoice; with one, nothing is charged until the trial ends.
 */
export function startSubscription(
  context: BachsContext,
  checkout: CheckoutSession,
  card: SavedCard,
  payment: Payment | null,
): Subscription {
  const subscription = context.bachs.subscriptions.add(
    draftSubscription(context, checkout, card),
    null,
  )

  if (payment) {
    const invoice = openInvoice(context, subscription, "subscription_create", payment.amount)

    context.bachs.payments.change(payment.id, {
      subscriptionId: subscription.id,
      invoiceId: invoice.id,
    })
    markPaid(context, invoice, payment.id)
  }

  announce(context, "created", subscription)
  context.wakeAt(new Date(subscription.periodEnd))

  return subscription
}

/** Opens an invoice for `subtotal`, drawing down the customer's credit first, and sends `invoice.created`. */
function openInvoice(
  context: BachsContext,
  subscription: Subscription,
  reason: string,
  subtotal: number,
): Invoice {
  const creditApplied = takeCredit(context, subscription, subtotal)
  const invoice = context.bachs.invoices.add(
    {
      id: bachsId("inv", 12),
      subscriptionId: subscription.id,
      customerId: subscription.customerId,
      status: "open",
      billingReason: reason,
      currency: subscription.currency,
      subtotal,
      creditApplied,
      total: subtotal - creditApplied,
      amountPaid: 0,
      periodStart: subscription.periodStart,
      periodEnd: subscription.periodEnd,
      attemptCount: 0,
      nextPaymentAttempt: null,
      chargeId: null,
      createdAt: iso(context.clock()),
    },
    null,
  )

  context.events.emit("invoice.created", invoiceObject(invoice, context.bachs))

  return invoice
}

/** Uses up to `amount` of the customer's credit in the subscription's currency; returns what was used. */
function takeCredit(context: BachsContext, subscription: Subscription, amount: number): number {
  const customer = context.bachs.customers.get(subscription.customerId)
  const available = customer?.credit[subscription.currency] ?? 0
  const used = Math.min(available, Math.max(amount, 0))

  if (customer && used > 0)
    context.bachs.customers.change(customer.id, {
      credit: { ...customer.credit, [subscription.currency]: available - used },
    })

  return used
}

/** Adds `amount` to the customer's credit in `currency`, for a downgrade. */
export function addCredit(
  context: BachsContext,
  customerId: string,
  currency: string,
  amount: number,
): void {
  const customer = context.bachs.customers.get(customerId)

  if (customer)
    context.bachs.customers.change(customer.id, {
      credit: { ...customer.credit, [currency]: (customer.credit[currency] ?? 0) + amount },
    })
}

function markPaid(context: BachsContext, invoice: Invoice, chargeId: string | null): Invoice {
  const paid =
    context.bachs.invoices.change(invoice.id, {
      status: "paid",
      amountPaid: invoice.total,
      chargeId,
      nextPaymentAttempt: null,
    }) ?? invoice

  context.events.emit("invoice.paid", invoiceObject(paid, context.bachs))

  return paid
}

/** Charges the subscription's saved card for an invoice, off-session; returns the payment. */
function chargeCard(context: BachsContext, subscription: Subscription, invoice: Invoice): Payment {
  const card = context.bachs.cards.get(subscription.paymentMethodId)
  const reason = card ? cardFailure(card.number) : "declined"
  const payment = context.bachs.payments.add(
    paymentRecord(context, {
      ...payerOf(context.bachs.customers.get(subscription.customerId)),
      status: reason ? "failed" : "succeeded",
      substatus: reason,
      amount: invoice.total,
      currency: invoice.currency,
      subscriptionId: subscription.id,
      invoiceId: invoice.id,
      billingReason: invoice.billingReason,
      method: cardMethod(invoice.currency),
      cardLast4: card?.last4 ?? null,
      completedAt: reason ? null : iso(context.clock()),
    }),
    null,
  )

  if (!reason) credit(context.bachs, payment.currency, payment.amount)
  context.events.emit(
    reason ? "collection.failed" : "collection.succeeded",
    collectionData(context, payment),
  )

  return payment
}

/**
 * Collects an open invoice: nothing to charge marks it paid; otherwise the card is charged, and a
 * failure counts an attempt and schedules the next retry.
 */
function collect(context: BachsContext, subscription: Subscription, invoice: Invoice): boolean {
  if (invoice.total <= 0) {
    markPaid(context, invoice, null)

    return true
  }

  const payment = chargeCard(context, subscription, invoice)

  if (payment.status === "succeeded") {
    markPaid(context, invoice, payment.id)

    return true
  }

  failCollection(context, subscription, invoice, payment)

  return false
}

/** A failed charge: the attempt is counted, the next retry scheduled (or recovery exhausted), the customer emailed. */
function failCollection(
  context: BachsContext,
  subscription: Subscription,
  invoice: Invoice,
  payment: Payment,
): void {
  const attempts = invoice.attemptCount + 1
  const delay = RETRY_DELAYS_MS[attempts - 1]
  const next = delay === undefined ? null : later(context.clock(), delay)
  const failed =
    context.bachs.invoices.change(invoice.id, {
      attemptCount: attempts,
      chargeId: payment.id,
      nextPaymentAttempt: next ? iso(next) : null,
    }) ?? invoice

  context.events.emit("invoice.payment_failed", invoiceObject(failed, context.bachs))

  if (next) {
    pastDue(context, subscription)
    sendRecoveryEmail(context, subscription, failed, false)
    context.wakeAt(next)

    return
  }

  exhaust(context, subscription, failed)
}

function pastDue(context: BachsContext, subscription: Subscription): void {
  if (subscription.status === "past_due") return

  announce(context, "updated", update(context, subscription, { status: "past_due" }))
}

/** Recovery ran out: the subscription is canceled, or marked unpaid when the account keeps them. */
function exhaust(context: BachsContext, subscription: Subscription, invoice: Invoice): void {
  context.bachs.invoices.change(invoice.id, { status: "uncollectible" })

  if (context.bachs.recovery() === "mark_unpaid") {
    sendRecoveryEmail(context, subscription, invoice, true)
    announce(context, "updated", update(context, subscription, { status: "unpaid" }))

    return
  }

  cancelNow(context, subscription, "payment_failed")
}

/** Emails the customer a link to a hosted page where they can enter a new card. */
function sendRecoveryEmail(
  context: BachsContext,
  subscription: Subscription,
  invoice: Invoice,
  exhausted: boolean,
): void {
  const customer = context.bachs.customers.get(subscription.customerId)

  if (!customer) return

  const token = hex(16)

  context.bachs.recoveryEmails.add(
    {
      id: bachsId("rec", 10),
      customerId: customer.id,
      subscriptionId: subscription.id,
      invoiceId: invoice.id,
      email: customer.email,
      token,
      link: `${CHECKOUT_ORIGIN}/recover/${token}`,
      exhausted,
      sentAt: iso(context.clock()),
    },
    null,
  )
}

/** Cancels at once: `canceled`, no further billing, and `customer.subscription.deleted`. */
export function cancelNow(
  context: BachsContext,
  subscription: Subscription,
  reason: string | null,
): Subscription {
  const canceled = update(context, subscription, {
    status: "canceled",
    canceledAt: iso(context.clock()),
    cancelReason: reason,
    nextBilledAt: null,
  })

  announce(context, "deleted", canceled)

  return canceled
}

/**
 * The end of a period: a subscription set to cancel then is canceled; otherwise the next period
 * starts and its invoice is collected, ending a trial on the way.
 */
export function renew(context: BachsContext, subscription: Subscription): void {
  if (subscription.cancelAtPeriodEnd) {
    cancelNow(context, subscription, subscription.cancelReason)

    return
  }

  const start = new Date(subscription.periodEnd)
  const end = addCadence(start, subscription.billingCycle)
  const renewed = update(context, subscription, {
    status: subscription.status === "trialing" ? "active" : subscription.status,
    periodStart: iso(start),
    periodEnd: iso(end),
    previouslyBilledAt: iso(start),
    nextBilledAt: iso(end),
    trialEnd: subscription.status === "trialing" ? subscription.trialEnd : null,
    pendingProration: 0,
  })
  const subtotal = renewed.unitAmount * renewed.seats + subscription.pendingProration
  const invoice = openInvoice(context, renewed, "subscription_cycle", subtotal)
  const paid = collect(context, renewed, invoice)

  if (paid && subscription.status !== "active")
    announce(context, "updated", update(context, renewed, { status: "active" }))
  context.wakeAt(end)
}

/** A scheduled retry of an open invoice; success brings the subscription back to `active`. */
export function retryInvoice(context: BachsContext, invoice: Invoice): void {
  const subscription = context.bachs.subscriptions.get(invoice.subscriptionId)

  if (!subscription || subscription.status === "canceled") return
  if (collect(context, subscription, invoice)) reactivate(context, subscription)
}

function reactivate(context: BachsContext, subscription: Subscription): void {
  if (subscription.status === "active" || subscription.status === "trialing") return

  announce(context, "updated", update(context, subscription, { status: "active" }))
}

/**
 * The customer entered a new card (on the recovery page or in the portal): it becomes the
 * subscription's card and every open invoice is charged again.
 */
export function replaceCard(
  context: BachsContext,
  subscription: Subscription,
  card: SavedCard,
): Subscription {
  const current = update(context, subscription, { paymentMethodId: card.id })
  const open = context.bachs.invoices.where(
    (invoice) =>
      invoice.subscriptionId === subscription.id &&
      invoice.status !== "paid" &&
      invoice.status !== "void",
  )
  let paid = true

  for (const invoice of open) {
    const reopened = context.bachs.invoices.change(invoice.id, { status: "open" }) ?? invoice

    paid = collect(context, current, reopened) && paid
  }

  if (paid && current.status !== "canceled") reactivate(context, current)

  return context.bachs.subscriptions.get(subscription.id) ?? current
}

/** Bills a prorated charge now on its own invoice (an upgrade with `invoice_now`). */
export function invoiceNow(
  context: BachsContext,
  subscription: Subscription,
  amount: number,
): void {
  const invoice = openInvoice(context, subscription, "subscription_update", amount)

  collect(context, subscription, invoice)
}

export { update as changeSubscription }
