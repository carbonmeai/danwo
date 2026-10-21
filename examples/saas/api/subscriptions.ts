/**
 * Keeping a workspace's subscription in step with Stripe. Whatever told Relay something changed (a
 * webhook, the return from Checkout, a plan change), the subscription is read from Stripe again and
 * saved as Stripe has it now. A late or repeated webhook then can't put an old status back.
 */
import { eq } from "drizzle-orm"
import type { Stripe } from "stripe"

import { query } from "../shared/db/client.ts"
import { workspaces } from "../shared/db/schema.ts"
import { stripe, stripeCall } from "./stripe.ts"

/** The Stripe price id of a plan's lookup key, as the seed names them. */
export function priceOf(plan: string): string {
  return `price_${plan}`
}

/** A plan's lookup key from a Stripe price id. */
function planOfPrice(price: string | undefined): string | undefined {
  return price?.startsWith("price_") ? price.slice("price_".length) : undefined
}

/** Unix seconds as a Date, or null. */
function dateOf(seconds: number | null | undefined): Date | null {
  return typeof seconds === "number" ? new Date(seconds * 1000) : null
}

/** The fields of a workspace that mirror `subscription`. */
export function mirrorOf(subscription: Stripe.Subscription) {
  const item = subscription.items.data[0]

  return {
    stripeSubscriptionId: subscription.id,
    subscriptionStatus: subscription.status,
    trialEndsAt: dateOf(subscription.trial_end),
    currentPeriodEnd: dateOf(item?.current_period_end),
    hasPaymentMethod: subscription.default_payment_method !== null,
    ...(planOfPrice(item?.price.id) !== undefined && { plan: planOfPrice(item?.price.id) }),
  }
}

/** Saves `subscription` on its workspace, found by the id it carries in its metadata. */
export async function saveSubscription(subscription: Stripe.Subscription): Promise<void> {
  const workspaceId = subscription.metadata.workspace_id

  if (!workspaceId) return

  await query("save subscription", (db) =>
    db.update(workspaces).set(mirrorOf(subscription)).where(eq(workspaces.id, workspaceId)),
  )
}

/**
 * Reads subscription `id` from Stripe and saves it. A webhook's own copy of the subscription is
 * never saved: a late or reordered delivery would carry a status that is no longer true.
 */
export async function syncSubscription(id: string): Promise<Stripe.Subscription> {
  const subscription = await stripeCall("retrieve subscription", () =>
    stripe.subscriptions.retrieve(id),
  )

  await saveSubscription(subscription)

  return subscription
}
