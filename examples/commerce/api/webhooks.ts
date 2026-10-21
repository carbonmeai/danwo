/**
 * Stripe's webhook. Every delivery's signature is checked first; a forged or stale one is refused
 * and changes nothing. Each event is acted on once (see `firstDelivery`), and anything that fails
 * answers 500, so Stripe delivers the event again later.
 */
import { and, eq, ne } from "drizzle-orm"
import { Hono } from "hono"
import type { Stripe } from "stripe"

import { query, transaction } from "./db/client.ts"
import { orders } from "./db/schema.ts"
import { firstDelivery, fulfilCheckout } from "./fulfil.ts"
import { sendReceiptSoon } from "./receipts.ts"
import { settings } from "./settings.ts"
import { stripe } from "./stripe.ts"

/** The verified event a delivery carries, or undefined when its signature does not check out. */
function verified(body: string, signature: string | undefined): Stripe.Event | undefined {
  try {
    return stripe.webhooks.constructEvent(body, signature ?? "", settings.STRIPE_WEBHOOK_SECRET)
  } catch {
    return undefined
  }
}

/** The orders a Checkout Session paid for: one, unless a safeguard is off. */
async function ordersOf(sessionId: string): Promise<number[]> {
  const rows = await query("find the session's orders", (db) =>
    db.select({ id: orders.id }).from(orders).where(eq(orders.checkoutSessionId, sessionId)),
  )

  return rows.map((row) => row.id)
}

/** Marks the order a refunded charge paid for as refunded; the refund may have started anywhere. */
function markRefunded(event: Stripe.Event, charge: Stripe.Charge): Promise<void> {
  const intent = typeof charge.payment_intent === "string" ? charge.payment_intent : undefined

  return transaction("mark order refunded", async (tx) => {
    if (!intent || !charge.refunded || !(await firstDelivery(tx, event))) return

    await tx
      .update(orders)
      .set({ status: "refunded", refundedAt: new Date() })
      .where(and(eq(orders.paymentIntentId, intent), ne(orders.status, "refunded")))
  })
}

export const webhooks = new Hono().post("/webhooks/stripe", async (c) => {
  const event = verified(await c.req.text(), c.req.header("stripe-signature"))

  if (!event) return c.json({ error: "bad signature" }, 400)

  if (event.type === "checkout.session.completed") {
    await fulfilCheckout(event, event.data.object)

    /*
     * The receipt goes out for the session's order however it got there: this delivery, an
     * earlier one, or a retry whose COMMIT answer was lost. It is a no-op once sent.
     */
    for (const orderId of await ordersOf(event.data.object.id)) await sendReceiptSoon(orderId)
  } else if (event.type === "charge.refunded") {
    await markRefunded(event, event.data.object)
  }

  return c.json({ received: true })
})
