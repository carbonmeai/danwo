/**
 * Subscriptions over time: one starts with its first invoice (free during a trial), renews at the
 * end of each period on the emulator's clock, falls `past_due` when a renewal's charge fails,
 * and ends when canceled, at once or at the end of its period.
 */
import {
  type MissingPaymentMethod,
  subscriptionItemObject,
  subscriptionObject,
} from "./billing-objects.ts"
import type { Customer, Invoice, Price, Subscription, SubscriptionItem } from "./entities.ts"
import { newId, unix } from "./helpers.ts"
import {
  type Billing,
  type Collection,
  collect,
  defaultMethodOf,
  openInvoice,
  periodAmounts,
} from "./invoicing.ts"

const DAY_S = 86_400

/** One price a subscription is asked to bill. */
export interface ItemRequest {
  readonly price: Price
  readonly quantity: number
  readonly metadata: Record<string, string>
}

/** How a new subscription's first invoice is paid. */
export type PaymentBehavior = "allow_incomplete" | "default_incomplete" | "error_if_incomplete"

/** What `subscribe` is asked for. */
export interface SubscribeRequest {
  readonly customer: Customer
  readonly items: readonly ItemRequest[]
  /** When the trial ends (Unix seconds), or null for none. */
  readonly trialEnd: number | null
  readonly defaultPaymentMethod: string | null
  readonly behavior: PaymentBehavior
  readonly missingPaymentMethod: MissingPaymentMethod
  readonly saveDefaultPaymentMethod: "off" | "on_subscription"
  readonly description: string | null
  readonly metadata: Record<string, string>
}

/** Why a subscription could not be started, as Stripe answers it. */
export interface SubscribeFailure {
  readonly status: number
  readonly type: "invalid_request_error" | "card_error"
  readonly code: string
  readonly message: string
}

/** The end of a period that starts at `start` (Unix seconds) for a recurring price. */
export function periodEnd(start: number, price: Price): number {
  const interval = price.recurring?.interval ?? "month"
  const count = price.recurring?.interval_count ?? 1

  if (interval === "day") return start + count * DAY_S
  if (interval === "week") return start + count * 7 * DAY_S

  const date = new Date(start * 1000)

  if (interval === "month") date.setUTCMonth(date.getUTCMonth() + count)
  else date.setUTCFullYear(date.getUTCFullYear() + count)

  return Math.floor(date.getTime() / 1000)
}

/** The items of a new subscription, each billed from `start` to `end`. */
function newItems(
  id: string,
  items: readonly ItemRequest[],
  start: number,
  end: (price: Price) => number,
): SubscriptionItem[] {
  return items.map((item) =>
    subscriptionItemObject({
      id: newId("si", 14),
      created: start,
      subscription: id,
      price: item.price,
      quantity: item.quantity,
      periodStart: start,
      periodEnd: end(item.price),
      metadata: item.metadata,
    }),
  )
}

/** The end of the subscription's current period: its first item's. */
export function currentPeriodEnd(subscription: Subscription): number {
  return subscription.items.data[0]?.current_period_end ?? subscription.created
}

/** The status a collection leaves a subscription in. */
function statusAfter(outcome: Collection, renewal: boolean): Subscription["status"] {
  if (outcome === "paid") return "active"

  return renewal ? "past_due" : "incomplete"
}

/** Stores a change and sends `customer.subscription.updated`. */
export function changeSubscription(
  billing: Billing,
  subscription: Subscription,
  changes: Partial<Subscription>,
): Subscription {
  const changed = billing.objects.subscriptions.change(subscription.id, changes) ?? subscription

  billing.events.emit("customer.subscription.updated", changed)

  return changed
}

/** Wakes the clock for the subscription's next due moment: its trial notice or period end. */
export function scheduleNext(billing: Billing, subscription: Subscription): void {
  billing.wakeAt(new Date(currentPeriodEnd(subscription) * 1000))
  if (subscription.trial_end !== null)
    billing.wakeAt(new Date((subscription.trial_end - 3 * DAY_S) * 1000))
}

/**
 * Starts a subscription and bills its first period: free during a trial, otherwise charged to
 * its default card. Without a card and outside a trial it is refused, as Stripe refuses it.
 */
export function subscribe(
  billing: Billing,
  request: SubscribeRequest,
): Subscription | SubscribeFailure {
  const now = unix(billing.clock())
  const id = newId("sub")
  const trialing = request.trialEnd !== null && request.trialEnd > now
  const end = (price: Price) => (trialing ? (request.trialEnd ?? now) : periodEnd(now, price))
  const draft = subscriptionObject({
    id,
    created: now,
    customer: request.customer.id,
    currency: request.items[0]?.price.currency ?? "usd",
    items: newItems(id, request.items, now, end),
    status: trialing ? "trialing" : "incomplete",
    trialStart: trialing ? now : null,
    trialEnd: trialing ? request.trialEnd : null,
    missingPaymentMethod: request.missingPaymentMethod,
    defaultPaymentMethod: request.defaultPaymentMethod,
    description: request.description,
    metadata: request.metadata,
    saveDefaultPaymentMethod: request.saveDefaultPaymentMethod,
  })
  const method = defaultMethodOf(billing, draft)
  const amounts = trialing ? draft.items.data.map(() => 0) : periodAmounts(draft)
  const total = amounts.reduce((sum, amount) => sum + amount, 0)

  if (total > 0 && method === null && request.behavior !== "default_incomplete")
    return {
      status: 400,
      type: "invalid_request_error",
      code: "resource_missing",
      message:
        "This customer has no attached payment source or default payment method. Please consider adding a default payment method.",
    }

  const stored = billing.objects.subscriptions.add(draft, { trialNoticeSent: false })

  billing.events.emit("customer.subscription.created", stored)

  return firstInvoice(billing, stored, amounts, method, request.behavior)
}

/** Bills a new subscription's first period and settles its status from the outcome. */
function firstInvoice(
  billing: Billing,
  subscription: Subscription,
  amounts: readonly number[],
  method: string | null,
  behavior: PaymentBehavior,
): Subscription | SubscribeFailure {
  const opened = openInvoice(billing, subscription, "subscription_create", amounts)
  const { invoice, outcome } = collect(billing, opened, method, {
    confirmLater: behavior === "default_incomplete",
    description: "Subscription creation",
  })

  if (outcome === "declined" && behavior === "error_if_incomplete") {
    billing.objects.subscriptions.remove(subscription.id)

    return {
      status: 402,
      type: "card_error",
      code: "card_declined",
      message: "Your card was declined.",
    }
  }

  const status = subscription.status === "trialing" ? "trialing" : statusAfter(outcome, false)
  const settled =
    billing.objects.subscriptions.change(subscription.id, { latest_invoice: invoice.id, status }) ??
    subscription

  if (status !== subscription.status) billing.events.emit("customer.subscription.updated", settled)
  scheduleNext(billing, settled)

  return settled
}

/** Why a subscription ended or is set to end, as `cancellation_details` shows it. */
export function cancellationDetails(
  reason: "cancellation_requested" | "payment_disabled" | "payment_failed",
): Subscription["cancellation_details"] {
  return { comment: null, feedback: null, feedback_option: null, reason }
}

/** Ends a subscription now, as canceling it or its period ending after `cancel_at` does. */
export function endSubscription(
  billing: Billing,
  subscription: Subscription,
  reason: "cancellation_requested" | "payment_disabled" | "payment_failed",
): Subscription {
  const now = unix(billing.clock())
  const ended =
    billing.objects.subscriptions.change(subscription.id, {
      status: "canceled",
      canceled_at: subscription.canceled_at ?? now,
      ended_at: now,
      cancellation_details: cancellationDetails(reason),
    }) ?? subscription

  billing.events.emit("customer.subscription.deleted", ended)

  return ended
}

/** The subscription's items moved on to the period starting at `start`. */
function nextItems(subscription: Subscription, start: number): SubscriptionItem[] {
  return subscription.items.data.map((item) => ({
    ...item,
    current_period_start: start,
    current_period_end: periodEnd(start, item.price),
  }))
}

/**
 * Renews a subscription whose period (or trial) has ended: it ends instead when it was set to
 * cancel then, or when a trial ends without a card and the subscription says to cancel. A
 * renewal charge that fails leaves it `past_due` with the invoice open.
 */
export function renew(billing: Billing, subscription: Subscription): Subscription {
  const start = currentPeriodEnd(subscription)
  const method = defaultMethodOf(billing, subscription)
  const endBehavior = subscription.trial_settings?.end_behavior.missing_payment_method

  if (subscription.cancel_at !== null && subscription.cancel_at <= start)
    return endSubscription(billing, subscription, "cancellation_requested")
  if (subscription.status === "trialing" && method === null && endBehavior === "cancel")
    return endSubscription(billing, subscription, "payment_disabled")

  const items = nextItems(subscription, start)
  const moved =
    billing.objects.subscriptions.change(subscription.id, {
      items: { ...subscription.items, data: items },
      ...(subscription.status === "trialing" && { billing_cycle_anchor: start }),
    }) ?? subscription
  const opened = openInvoice(billing, moved, "subscription_cycle", periodAmounts(moved))
  const { invoice, outcome } = collect(billing, opened, method, {
    description: "Subscription update",
  })
  const renewed = changeSubscription(billing, moved, {
    latest_invoice: invoice.id,
    status: statusAfter(outcome, true),
  })

  scheduleNext(billing, renewed)

  return renewed
}

/** A subscription whose open invoice was just paid: active again. */
export function invoicePaid(billing: Billing, invoice: Invoice): void {
  const id = invoice.parent?.subscription_details?.subscription
  const subscription = typeof id === "string" ? billing.objects.subscriptions.get(id) : undefined

  if (!subscription || subscription.latest_invoice !== invoice.id) return
  if (subscription.status === "incomplete" || subscription.status === "past_due")
    changeSubscription(billing, subscription, { status: "active" })
}

/** One piece of billing work that falls due at `at` (Unix seconds). */
interface Due {
  readonly at: number
  run(): void
}

/** Every subscription's next due work: its trial notice, renewal or the expiry of its first payment. */
function dueWork(billing: Billing): Due[] {
  const { subscriptions } = billing.objects

  return subscriptions.all().flatMap((subscription): Due[] => {
    const state = subscriptions.extra(subscription.id)
    const work: Due[] = []

    if (subscription.status === "incomplete")
      work.push({
        at: subscription.created + DAY_S - 3600,
        run: () => changeSubscription(billing, subscription, { status: "incomplete_expired" }),
      })
    if (
      subscription.status === "trialing" &&
      subscription.trial_end !== null &&
      !state?.trialNoticeSent
    )
      work.push({
        at: subscription.trial_end - 3 * DAY_S,
        run: () => {
          subscriptions.setExtra(subscription.id, { trialNoticeSent: true })
          billing.events.emit("customer.subscription.trial_will_end", subscription)
        },
      })
    if (["active", "trialing", "past_due"].includes(subscription.status))
      work.push({ at: currentPeriodEnd(subscription), run: () => renew(billing, subscription) })

    return work
  })
}

/** At most this many pieces of work run in one pass, so a misbehaving loop still ends. */
const MAX_PER_PASS = 500

/** Runs the billing work that has fallen due, oldest first, one piece at a time. */
export function runDue(billing: Billing): void {
  for (let done = 0; done < MAX_PER_PASS; done++) {
    const now = unix(billing.clock())
    const next = dueWork(billing)
      .filter((work) => work.at <= now)
      .toSorted((a, b) => a.at - b.at)[0]

    if (!next) return

    next.run()
  }
}
