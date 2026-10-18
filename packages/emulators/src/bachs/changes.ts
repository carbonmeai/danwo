/**
 * Changes to a live subscription, one per request: the plan, the seat count, the trial, or the
 * metadata. Plan and seat changes are prorated by the exact share of the period left.
 */
import { addCredit, announce, changeSubscription, invoiceNow, renew } from "./billing.ts"
import type { BachsContext } from "./context.ts"
import type { Subscription } from "./entities.ts"
import { BachsFailure, invalid } from "./helpers.ts"

export type ProrationBehavior = "invoice_now" | "next_cycle" | "none"

/** The proration behaviour a request asked for; `invoice_now` when it named none. */
export function prorationOf(value: unknown): ProrationBehavior {
  if (value === undefined || value === null) return "invoice_now"
  if (value === "invoice_now" || value === "next_cycle" || value === "none") return value

  throw new BachsFailure(
    400,
    "PRORATION_BEHAVIOR_NOT_SUPPORTED",
    `proration_behavior ${JSON.stringify(value)} is not supported`,
  )
}

/** The share of the current period still ahead, between 0 and 1. */
function remaining(context: BachsContext, subscription: Subscription): number {
  const start = Date.parse(subscription.periodStart)
  const end = Date.parse(subscription.periodEnd)
  const now = context.clock().getTime()

  return end <= start ? 0 : Math.min(Math.max((end - now) / (end - start), 0), 1)
}

/**
 * Settles moving from `oldAmount` to `newAmount` for the rest of the period: a charge now, on the
 * next renewal, or not at all; a credit (always) when the new amount is lower.
 */
function prorate(
  context: BachsContext,
  subscription: Subscription,
  oldAmount: number,
  newAmount: number,
  behavior: ProrationBehavior,
): Subscription {
  const net = Math.round((newAmount - oldAmount) * remaining(context, subscription))

  if (net < 0) addCredit(context, subscription.customerId, subscription.currency, -net)
  if (net <= 0 || behavior === "none") return subscription
  if (behavior === "next_cycle")
    return changeSubscription(context, subscription, {
      pendingProration: subscription.pendingProration + net,
    })

  invoiceNow(context, subscription, net)

  return context.bachs.subscriptions.get(subscription.id) ?? subscription
}

function modifiable(subscription: Subscription): void {
  if (!["active", "trialing", "past_due"].includes(subscription.status))
    throw new BachsFailure(
      400,
      "SUBSCRIPTION_NOT_MODIFIABLE",
      `Subscription is ${subscription.status} and cannot be changed`,
    )
}

/** Moves the subscription to another recurring product at the same interval and currency. */
export function changePlan(
  context: BachsContext,
  subscription: Subscription,
  productId: string,
  behavior: ProrationBehavior,
): Subscription {
  modifiable(subscription)

  const product = context.bachs.products.get(productId)

  if (!product || product.archivedAt)
    throw new BachsFailure(400, "PRODUCT_NOT_FOUND", `Product ${productId} not found`)

  const cycle = product.billingCycle

  if (
    !cycle ||
    cycle.interval !== subscription.billingCycle.interval ||
    cycle.frequency !== subscription.billingCycle.frequency
  )
    throw new BachsFailure(
      400,
      "SUBSCRIPTION_PLAN_INTERVAL_MISMATCH",
      "The target product must bill at the same interval as the subscription",
    )
  if (product.price.currency !== subscription.currency)
    throw new BachsFailure(
      400,
      "PLAN_NOT_PRICED_IN_CURRENCY",
      `The target product has no price in ${subscription.currency}`,
    )

  const unit = product.price.amount ?? 0
  const prorated = prorate(
    context,
    subscription,
    subscription.unitAmount * subscription.seats,
    unit * subscription.seats,
    behavior,
  )

  return changeSubscription(context, prorated, {
    productId: product.id,
    unitAmount: unit,
    priceType: product.price.type,
  })
}

/** Sets the seat count; adding seats is charged per `behavior`, removing them is always a credit. */
export function changeSeats(
  context: BachsContext,
  subscription: Subscription,
  seats: number,
  behavior: ProrationBehavior,
): Subscription {
  modifiable(subscription)

  if (!Number.isInteger(seats) || seats < 1)
    invalid("seats must be 1 or more", {
      field: "seats",
      message: "Must be 1 or more",
      type: "value_error",
    })

  const prorated = prorate(
    context,
    subscription,
    subscription.unitAmount * subscription.seats,
    subscription.unitAmount * seats,
    behavior,
  )

  return changeSubscription(context, prorated, { seats })
}

/**
 * Moves the trial's end: a future time adds or extends a trial (even on an active subscription); now
 * or the past ends a running trial and bills the first cycle at once.
 */
export function changeTrial(
  context: BachsContext,
  subscription: Subscription,
  trialEnd: string,
): Subscription {
  const at = Date.parse(trialEnd)

  if (Number.isNaN(at))
    invalid("trial_end must be an ISO 8601 time", {
      field: "trial_end",
      message: "Invalid datetime",
      type: "value_error",
    })

  if (at > context.clock().getTime()) {
    const extended = changeSubscription(context, subscription, {
      status: "trialing",
      trialEnd: new Date(at).toISOString(),
      periodEnd: new Date(at).toISOString(),
      nextBilledAt: new Date(at).toISOString(),
    })

    context.wakeAt(new Date(at))

    return extended
  }

  if (subscription.status !== "trialing")
    throw new BachsFailure(400, "SUBSCRIPTION_NOT_TRIALING", "The subscription is not in a trial")

  const now = context.clock().toISOString()

  renew(context, changeSubscription(context, subscription, { periodEnd: now, trialEnd: now }))

  return context.bachs.subscriptions.get(subscription.id) ?? subscription
}

/** Merges metadata: an empty-string value removes that key, an empty string clears it all. */
export function changeMetadata(
  subscription: Subscription,
  metadata: Record<string, unknown> | "",
): Record<string, unknown> {
  if (metadata === "") return { checkout_id: subscription.metadata["checkout_id"] }

  const merged: Record<string, unknown> = { ...subscription.metadata }

  for (const [key, value] of Object.entries(metadata))
    if (key !== "checkout_id") {
      if (value === "") delete merged[key]
      else merged[key] = value
    }

  return merged
}

/** Cancels at the end of the period (`customer.subscription.updated`) rather than now. */
export function cancelAtPeriodEnd(
  context: BachsContext,
  subscription: Subscription,
  reason: string | null,
): Subscription {
  const scheduled = changeSubscription(context, subscription, {
    cancelAtPeriodEnd: true,
    cancelReason: reason,
  })

  announce(context, "updated", scheduled)

  return scheduled
}
