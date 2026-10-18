/**
 * Money coming in: a checkout paid on the hosted page, the payment settling a moment later, the
 * checkout completing, and deposits into a virtual account.
 */
import { credit } from "./balance.ts"
import { startSubscription } from "./billing.ts"
import { cardDigits, cardFailure, failureMessage } from "./cards.ts"
import { collectionData, depositFee } from "./collection.ts"
import type { BachsContext } from "./context.ts"
import { matchOrCreateCustomer } from "./customers.ts"
import type { CheckoutSession, Customer, DepositDetails, Payment, SavedCard } from "./entities.ts"
import {
  checkoutTotal,
  customerObject,
  paymentObject,
  paymentStatusOf,
  subscriptionObject,
} from "./formatters.ts"
import { bachsId, iso, later, money } from "./helpers.ts"
import { cardMethod, paymentRecord } from "./payment-record.ts"

/** How long a sandbox card payment takes to finalize after the customer pays. */
const SETTLE_MS = 1000

/** What the buyer entered on the hosted page. */
export interface PayForm {
  readonly card: string
  readonly email: string | null
  readonly name: string | null
  readonly amount: number | null
}

/** How paying went: on to the success URL, or back to the page with a message. */
export type PayResult =
  | { readonly ok: true; readonly redirect: string | null }
  | { readonly ok: false; readonly message: string }

function touch(
  context: BachsContext,
  checkout: CheckoutSession,
  changes: Partial<CheckoutSession>,
): CheckoutSession {
  return (
    context.bachs.checkouts.change(checkout.id, { ...changes, updatedAt: iso(context.clock()) }) ??
    checkout
  )
}

/** The customer a paying checkout bills, created or matched when the page collected an identity. */
function payingCustomer(
  context: BachsContext,
  checkout: CheckoutSession,
  form: PayForm,
): Customer | null {
  if (checkout.customerId) return context.bachs.customers.get(checkout.customerId) ?? null

  const keeps = checkout.customerCreation === "always" || checkout.mode === "subscription"

  return keeps && form.email
    ? matchOrCreateCustomer(context, { email: form.email, name: form.name })
    : null
}

/** Records who paid: the customer behind the checkout and the details the buyer gave. */
function identify(
  context: BachsContext,
  checkout: CheckoutSession,
  form: PayForm,
): CheckoutSession {
  const customer = payingCustomer(context, checkout, form)
  const email = customer?.email ?? form.email
  const details = email ? { email, name: customer?.name ?? form.name } : checkout.customerDetails

  return touch(context, checkout, { customerId: customer?.id ?? null, customerDetails: details })
}

/** The amount a custom-priced checkout charges, or a message when the buyer's choice is out of bounds. */
function chosenAmount(checkout: CheckoutSession, form: PayForm): number | string | null {
  const custom = checkout.lines.find((line) => line.price.type === "custom")

  if (!custom) return null

  const amount = form.amount ?? custom.price.preset

  if (amount === null) return "Enter an amount."
  if (custom.price.minimum !== null && amount < custom.price.minimum)
    return `Enter at least ${money(custom.price.minimum)}.`
  if (custom.price.maximum !== null && amount > custom.price.maximum)
    return `Enter at most ${money(custom.price.maximum)}.`

  return amount
}

/** A new payment for a checkout, before its outcome is known. */
function newPayment(context: BachsContext, checkout: CheckoutSession, card: string): Payment {
  return paymentRecord(context, {
    status: "processing",
    amount: checkoutTotal(checkout),
    currency: checkout.currency,
    checkoutId: checkout.id,
    customerId: checkout.customerId,
    customerEmail: checkout.customerDetails?.email ?? null,
    customerName: checkout.customerDetails?.name ?? null,
    reference: checkout.reference,
    billingReason: checkout.mode === "subscription" ? "subscription_create" : "checkout",
    method: cardMethod(checkout.currency),
    cardLast4: cardDigits(card).slice(-4),
    metadata: checkout.metadata,
    settlesAt: iso(later(context.clock(), SETTLE_MS)),
  })
}

/** Saves the card a subscription checkout was paid with, for renewals. */
export function saveCard(context: BachsContext, customerId: string, number: string): SavedCard {
  const digits = cardDigits(number)

  return context.bachs.cards.add(
    { id: bachsId("pm", 10), customerId, number: digits, last4: digits.slice(-4) },
    null,
  )
}

/** Where the buyer goes after paying: the success URL with `?checkout_id=` appended. */
function successRedirect(checkout: CheckoutSession): string | null {
  if (!checkout.successUrl) return null

  const url = new URL(checkout.successUrl)

  url.searchParams.set("checkout_id", checkout.id)

  return url.toString()
}

/** A failed attempt: the checkout stays open and `collection.failed` goes out. */
function failAttempt(context: BachsContext, payment: Payment, reason: string): PayResult {
  const failed = context.bachs.payments.add(
    { ...payment, status: "open", substatus: "last_attempt_failed", settlesAt: null },
    null,
  )

  context.events.emit("collection.failed", {
    ...collectionData(context, failed),
    status: "FAILED",
    failure_reason: reason,
  })

  return { ok: false, message: failureMessage(reason) }
}

/**
 * Pays an open checkout with the hosted page's form. A free checkout or a trial completes at once;
 * a card payment is processing until it settles about a second later.
 */
export function payCheckout(
  context: BachsContext,
  open: CheckoutSession,
  form: PayForm,
): PayResult {
  const amount = chosenAmount(open, form)

  if (typeof amount === "string") return { ok: false, message: amount }
  if (!open.customerId && !form.email) return { ok: false, message: "Enter your email address." }

  const checkout = identify(context, touch(context, open, { chosenAmount: amount }), form)
  const reason = cardFailure(form.card)

  if (checkoutTotal(checkout) === 0 || trialProduct(context, checkout))
    return reason
      ? { ok: false, message: failureMessage(reason) }
      : payWithoutCharge(context, checkout, form.card)

  return reason
    ? failAttempt(context, newPayment(context, checkout, form.card), reason)
    : payByCard(context, checkout, form.card)
}

/** A checkout that takes nothing now completes at once. */
function payWithoutCharge(
  context: BachsContext,
  checkout: CheckoutSession,
  card: string,
): PayResult {
  completeWithoutPayment(context, checkout, card)

  return { ok: true, redirect: successRedirect(checkout) }
}

/** A card payment starts processing; it settles about a second later. */
function payByCard(context: BachsContext, checkout: CheckoutSession, card: string): PayResult {
  const payment = context.bachs.payments.add(newPayment(context, checkout, card), null)

  touch(context, checkout, { paymentId: payment.id })
  if (checkout.mode === "subscription" && checkout.customerId)
    saveCard(context, checkout.customerId, card)
  context.wakeAt(later(context.clock(), SETTLE_MS))

  return { ok: true, redirect: successRedirect(checkout) }
}

/** Whether a subscription checkout's product starts with a free trial. */
function trialProduct(context: BachsContext, checkout: CheckoutSession): boolean {
  if (checkout.mode !== "subscription") return false

  const line = checkout.lines.find((item) => item.recurring)
  const product = line?.productId ? context.bachs.products.get(line.productId) : undefined

  return Boolean(product?.trialPeriod)
}

/** A checkout that takes no money now: a free cart, or a trial that only saves the card. */
function completeWithoutPayment(
  context: BachsContext,
  checkout: CheckoutSession,
  card: string,
): void {
  if (checkout.mode === "subscription" && checkout.customerId) {
    const saved = saveCard(context, checkout.customerId, card)
    const subscription = startSubscription(context, checkout, saved, null)

    finishCheckout(context, touch(context, checkout, { subscriptionId: subscription.id }))

    return
  }

  finishCheckout(context, checkout)
}

/** Marks a checkout completed and sends `checkout.completed`. */
function finishCheckout(context: BachsContext, checkout: CheckoutSession): void {
  const done = touch(context, checkout, { status: "completed", completedAt: iso(context.clock()) })

  context.events.emit("checkout.completed", checkoutCompletedData(context, done))
}

/** A checkout as `checkout.completed` carries it. */
function checkoutCompletedData(
  context: BachsContext,
  checkout: CheckoutSession,
): Record<string, unknown> {
  const { bachs } = context
  const payment = checkout.paymentId ? bachs.payments.get(checkout.paymentId) : undefined
  const customer = checkout.customerId ? bachs.customers.get(checkout.customerId) : undefined
  const subscription = checkout.subscriptionId
    ? bachs.subscriptions.get(checkout.subscriptionId)
    : undefined

  return {
    checkout_id: checkout.id,
    status: checkout.status,
    mode: checkout.mode,
    payment_status: paymentStatusOf(checkout, payment),
    amount: money(checkoutTotal(checkout)),
    currency: checkout.currency,
    reference: checkout.reference,
    customer: customer ? customerObject(customer) : null,
    customer_details: checkout.customerDetails,
    charge: payment ? paymentObject(payment) : null,
    subscription: subscription ? subscriptionObject(subscription, bachs) : null,
    success_url: checkout.successUrl,
    cancel_url: checkout.cancelUrl,
    metadata: checkout.metadata ?? {},
    completed_at: checkout.completedAt,
    expires_at: checkout.expiresAt,
    created_at: checkout.createdAt,
  }
}

/** A processing payment finalizes: money in, `collection.succeeded`, and its checkout completes. */
export function settlePayment(context: BachsContext, processing: Payment): void {
  const { bachs } = context
  const now = iso(context.clock())
  const payment =
    bachs.payments.change(processing.id, {
      status: "succeeded",
      settlesAt: null,
      completedAt: now,
      updatedAt: now,
    }) ?? processing

  credit(bachs, payment.currency, payment.amount)
  context.events.emit("collection.succeeded", collectionData(context, payment))

  const checkout = payment.checkoutId ? bachs.checkouts.get(payment.checkoutId) : undefined

  if (!checkout || checkout.status !== "open") return

  if (checkout.mode === "subscription" && checkout.customerId) {
    const card = bachs.cards.where((saved) => saved.customerId === checkout.customerId).at(-1)

    if (card) {
      const subscription = startSubscription(context, checkout, card, payment)

      finishCheckout(context, touch(context, checkout, { subscriptionId: subscription.id }))

      return
    }
  }

  finishCheckout(context, checkout)
}

/** An open checkout past its expiry lapses and sends `checkout.expired`. */
export function expireCheckout(context: BachsContext, checkout: CheckoutSession): void {
  const expired = touch(context, checkout, { status: "expired" })

  context.events.emit("checkout.expired", {
    checkout_id: expired.id,
    status: "expired",
    reference: expired.reference,
    amount: money(checkoutTotal(expired)),
    currency: expired.currency,
    metadata: expired.metadata ?? {},
    expires_at: expired.expiresAt,
    created_at: expired.createdAt,
  })
}

/** Someone sends money to a virtual account: a deposit payment, settled at once. */
export function recordDeposit(
  context: BachsContext,
  deposit: DepositDetails,
  amount: number,
  currency: string,
): Payment {
  const payment = context.bachs.payments.add(
    paymentRecord(context, {
      status: "succeeded",
      amount,
      currency,
      customerName: deposit.senderName,
      billingReason: "deposit",
      method: "NGN_BANK_TRANSFER",
      deposit,
      completedAt: iso(context.clock()),
    }),
    null,
  )

  credit(context.bachs, currency, amount - depositFee(payment))
  context.events.emit("collection.succeeded", collectionData(context, payment))

  return payment
}
