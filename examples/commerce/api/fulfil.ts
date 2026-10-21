/**
 * Turning a paid Checkout Session into an order. Everything happens in one transaction: the
 * event is logged, the order and its lines are written, the stock is taken and the cart is
 * emptied, or none of it is. That is what makes a retry safe, whether Stripe sent the event twice
 * or the database lost the answer to the COMMIT: the second run finds the event logged (or the
 * order there) and stops.
 */
import { eq, sql } from "drizzle-orm"
import type { Stripe } from "stripe"

import { type Database, query, transaction, type Transaction } from "./db/client.ts"
import { cartItems, checkouts, orderItems, orders, products, webhookEvents } from "./db/schema.ts"
import { broken } from "./settings.ts"

/**
 * Logs `event` as handled; false when it already was. With COMMERCE_BUG=no-webhook-dedupe the
 * shop forgets every event, so a repeat delivery runs again.
 */
export async function firstDelivery(db: Database | Transaction, event: Stripe.Event) {
  if (broken("no-webhook-dedupe")) return true

  const logged = await db
    .insert(webhookEvents)
    .values({ id: event.id, type: event.type })
    .onConflictDoNothing()
    .returning({ id: webhookEvents.id })

  return logged.length > 0
}

/** Writes the session's order, or returns undefined when the session already has one. */
async function placeOrder(db: Database | Transaction, session: Stripe.Checkout.Session) {
  const [checkout] = await db.select().from(checkouts).where(eq(checkouts.sessionId, session.id))

  /* Stripe will deliver the event again later; by then the checkout is recorded. */
  if (!checkout) throw new Error(`no checkout recorded for ${session.id}`)

  const values = {
    checkoutSessionId: session.id,
    paymentIntentId: typeof session.payment_intent === "string" ? session.payment_intent : null,
    email: session.customer_details?.email ?? checkout.email,
    totalCents: session.amount_total ?? checkout.amountCents,
    currency: session.currency ?? "usd",
  }
  const [order] = broken("no-webhook-dedupe")
    ? await db.insert(orders).values(values).returning({ id: orders.id })
    : await db
        .insert(orders)
        .values(values)
        .onConflictDoNothing({ target: orders.checkoutSessionId })
        .returning({ id: orders.id })

  return order && { id: order.id, checkout }
}

/** The order's lines, the stock they take, and the cart they came from. */
async function fillOrder(
  db: Database | Transaction,
  order: NonNullable<Awaited<ReturnType<typeof placeOrder>>>,
) {
  const { lines, cartId } = order.checkout

  await db.insert(orderItems).values(lines.map((line) => ({ orderId: order.id, ...line })))

  for (const line of lines)
    await db
      .update(products)
      .set({ stock: sql`${products.stock} - ${line.quantity}` })
      .where(eq(products.id, line.productId))

  await db.delete(cartItems).where(eq(cartItems.cartId, cartId))
}

/** Every step of fulfilling a session, on `db`: a transaction, or (the bug) none. */
async function fulfilOn(
  db: Database | Transaction,
  event: Stripe.Event,
  session: Stripe.Checkout.Session,
): Promise<number | undefined> {
  if (!(await firstDelivery(db, event))) return undefined

  const order = await placeOrder(db, session)

  if (!order) return undefined

  await fillOrder(db, order)

  return order.id
}

/**
 * Fulfils a `checkout.session.completed` event; returns the new order's id, or undefined when
 * there was nothing to do (unpaid, a repeat, an order that exists). COMMERCE_BUG=no-txn runs the
 * same steps without a transaction, so a failure halfway leaves half an order behind.
 */
export function fulfilCheckout(
  event: Stripe.Event,
  session: Stripe.Checkout.Session,
): Promise<number | undefined> {
  if (session.payment_status !== "paid") return Promise.resolve(undefined)

  return broken("no-txn")
    ? query("fulfil checkout, step by step", (db) => fulfilOn(db, event, session))
    : transaction("fulfil checkout", (tx) => fulfilOn(tx, event, session))
}
