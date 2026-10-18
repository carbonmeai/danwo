/**
 * Payments as they end: each attempt becomes a transaction with its webhook, a successful one adds
 * its settled amount to the balance and, when it paid for a payment plan, starts a subscription that
 * charges the same card every interval.
 */
import { createHash } from "node:crypto"

import type { FlutterwaveState } from "./context.ts"
import type {
  PaymentLink,
  PaymentPlan,
  PaymentType,
  PlanInterval,
  Subscription,
  Transaction,
  TransactionCard,
  TransactionCustomer,
} from "./entities.ts"
import type { FlutterwaveEvents } from "./events.ts"
import { transactionObject } from "./formatters.ts"
import { hex, isoTime, nextId } from "./helpers.ts"

/** How one attempt at paying a link ended. */
export interface Outcome {
  readonly approved: boolean
  readonly processorResponse: string
  readonly paymentType: PaymentType
  readonly authModel: string
  readonly card?: TransactionCard
}

/** A customer id derived from the email, the same for every payment by that customer. */
function customerId(email: string): number {
  return 200_000_000 + (createHash("sha256").update(email).digest().readUInt32BE(0) % 100_000_000)
}

/** The customer a link was paid by. */
export function linkCustomer(link: Pick<PaymentLink, "customer">, now: Date): TransactionCustomer {
  return {
    id: customerId(link.customer.email),
    name: link.customer.name,
    phone_number: link.customer.phone_number,
    email: link.customer.email,
    created_at: isoTime(now),
  }
}

/** The card a payment used, as transactions show it. */
export function cardOf(number: string, network: string, expiry: string): TransactionCard {
  const digits = number.replace(/\s+/g, "")

  return {
    first_6digits: digits.slice(0, 6),
    last_4digits: digits.slice(-4),
    issuer: `${network} TEST BANK`,
    country: "NG",
    type: network,
    token: `flw-t1nf-${hex(16)}-m03k`,
    expiry,
  }
}

/** Stores a transaction, notes it on the timeline and sends its webhook. */
export function recordTransaction(
  context: FlutterwaveState,
  events: FlutterwaveEvents,
  transaction: Transaction,
): Transaction {
  const stored = context.flutterwave.transactions.add(transaction, { events: [], refunded: 0 })

  events.note(stored, "initiate", `Payment of ${stored.currency} ${stored.amount} started`)
  events.note(stored, stored.status, stored.processor_response)

  if (stored.status === "successful") events.creditBalance(stored.currency, stored.amount_settled)

  events.charged(stored)

  return stored
}

/** Turns one attempt at a link into its transaction, and starts a subscription for a plan. */
export function payLink(
  context: FlutterwaveState,
  events: FlutterwaveEvents,
  link: PaymentLink,
  outcome: Outcome,
): Transaction {
  const now = context.clock()
  const transaction = recordTransaction(
    context,
    events,
    transactionObject({
      id: nextId(context.store),
      txRef: link.tx_ref,
      amount: link.amount,
      currency: link.currency,
      status: outcome.approved ? "successful" : "failed",
      processorResponse: outcome.processorResponse,
      paymentType: outcome.paymentType,
      authModel: outcome.authModel,
      customer: linkCustomer(link, now),
      ...(outcome.card && { card: outcome.card }),
      meta: link.meta,
      plan: link.payment_plan,
      now,
    }),
  )
  const plan =
    link.payment_plan === null
      ? undefined
      : context.flutterwave.plans.get(String(link.payment_plan))

  if (transaction.status === "successful" && plan && transaction.card)
    startSubscription(context, plan, transaction)

  return transaction
}

/** `date` moved on by one `interval`. */
function afterInterval(date: Date, interval: PlanInterval): Date {
  const next = new Date(date)
  const months: Partial<Record<PlanInterval, number>> = {
    monthly: 1,
    quarterly: 3,
    "bi-annually": 6,
    yearly: 12,
  }
  const hours: Partial<Record<PlanInterval, number>> = { hourly: 1, daily: 24, weekly: 168 }

  if (months[interval] !== undefined) next.setUTCMonth(next.getUTCMonth() + months[interval])
  else next.setTime(next.getTime() + (hours[interval] ?? 24) * 3_600_000)

  return next
}

function startSubscription(
  context: FlutterwaveState,
  plan: PaymentPlan,
  transaction: Transaction,
): void {
  const now = context.clock()

  if (transaction.card === undefined) return

  context.flutterwave.subscriptions.add(
    {
      id: nextId(context.store),
      amount: plan.amount,
      customer: { id: transaction.customer.id, customer_email: transaction.customer.email },
      plan: plan.id,
      status: "active",
      created_at: isoTime(now),
    },
    {
      nextChargeAt: isoTime(afterInterval(now, plan.interval)),
      charges: 1,
      card: transaction.card,
      customer: transaction.customer,
    },
  )
}

/** What charging a subscription came to: nothing due yet, a charge, or its last charge. */
type Renewal = "not-due" | "charged" | "done"

/** Charges one due subscription and moves its next charge on. */
function chargeIfDue(
  context: FlutterwaveState,
  events: FlutterwaveEvents,
  subscription: Subscription,
): Renewal {
  const { subscriptions, plans } = context.flutterwave
  const extra = subscriptions.extra(String(subscription.id))
  const plan = plans.get(String(subscription.plan))
  const now = context.clock()

  if (extra === undefined || plan === undefined || new Date(extra.nextChargeAt) > now)
    return "not-due"

  recordTransaction(
    context,
    events,
    transactionObject({
      id: nextId(context.store),
      txRef: `rpp-${subscription.id}-${extra.charges + 1}`,
      amount: subscription.amount,
      currency: plan.currency,
      status: "successful",
      processorResponse: "Approved",
      paymentType: "card",
      authModel: "noauth",
      customer: extra.customer,
      card: extra.card,
      meta: null,
      plan: plan.id,
      now: new Date(extra.nextChargeAt),
    }),
  )

  const charges = extra.charges + 1
  const done = plan.duration > 0 && charges >= plan.duration

  subscriptions.setExtra(String(subscription.id), {
    ...extra,
    charges,
    nextChargeAt: isoTime(afterInterval(new Date(extra.nextChargeAt), plan.interval)),
  })
  if (!done) return "charged"

  subscriptions.change(String(subscription.id), { status: "completed" })

  return "done"
}

/**
 * Charges every active subscription whose next charge is due by the emulator's clock, catching up
 * on every interval that has passed. Returns how many charges were made.
 */
export function renewDue(context: FlutterwaveState, events: FlutterwaveEvents): number {
  let made = 0

  for (const subscription of context.flutterwave.subscriptions.all()) {
    if (subscription.status !== "active") continue

    for (let i = 0; i < 1000; i++) {
      const renewal = chargeIfDue(context, events, subscription)

      if (renewal === "not-due") break

      made++

      if (renewal === "done") break
    }
  }

  return made
}
