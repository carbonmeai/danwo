/**
 * Orders, for the customer ("My orders", found by the email they paid with) and for the admin:
 * every order with its status, refunds, and stock levels.
 */
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm"
import { Hono } from "hono"
import { Stripe } from "stripe"
import { z } from "zod"

import { type Database, query } from "./db/client.ts"
import { orderItems, orders, products } from "./db/schema.ts"
import { orderNumber } from "./receipts.ts"
import { describe } from "./retry.ts"
import { stripe, stripeCall } from "./stripe.ts"

/** Orders with their lines, newest first; `where` narrows them. */
async function ordersWithLines(db: Database, where?: ReturnType<typeof eq>) {
  const rows = await db.select().from(orders).where(where).orderBy(desc(orders.id)).limit(100)
  const lines =
    rows.length === 0
      ? []
      : await db
          .select()
          .from(orderItems)
          .where(
            inArray(
              orderItems.orderId,
              rows.map((row) => row.id),
            ),
          )
          .orderBy(asc(orderItems.productId))

  return rows.map((row) => ({
    id: row.id,
    number: orderNumber(row.id),
    email: row.email,
    status: row.status,
    totalCents: row.totalCents,
    currency: row.currency,
    createdAt: row.createdAt.toISOString(),
    receiptSent: row.receiptEmailId !== null,
    lines: lines
      .filter((line) => line.orderId === row.id)
      .map((line) => ({ name: line.name, quantity: line.quantity, unitCents: line.unitCents })),
  }))
}

/** What refunding an order came to, and what to tell the admin. */
type RefundOutcome =
  | { readonly status: 200; readonly body: { readonly status: "refunded" } }
  | { readonly status: 404 | 409 | 502; readonly body: { readonly error: string } }

/** Whether Stripe says the charge has no money left to refund: the refund happened already. */
function alreadyRefunded(error: unknown): boolean {
  return (
    error instanceof Stripe.errors.StripeInvalidRequestError &&
    error.code === "charge_already_refunded"
  )
}

/**
 * Refunds an order in full. The idempotency key is the order's Checkout Session, so a retry or a
 * second click never refunds twice. While Stripe is asked the order shows as refunding; if
 * Stripe cannot be reached it stays so, and the `charge.refunded` webhook settles it.
 */
async function refund(id: number): Promise<RefundOutcome> {
  const [order] = await query("read order", (db) =>
    db.select().from(orders).where(eq(orders.id, id)),
  )

  if (!order) return { status: 404, body: { error: "No such order." } }
  if (order.status === "refunded") return { status: 200, body: { status: "refunded" } }
  if (!order.paymentIntentId) return { status: 409, body: { error: "This order has no payment." } }

  const intent = order.paymentIntentId

  await query("mark order refunding", (db) =>
    db
      .update(orders)
      .set({ status: "refunding" })
      .where(and(eq(orders.id, id), eq(orders.status, "paid"))),
  )

  try {
    await stripeCall("refunds.create", () =>
      stripe.refunds.create(
        {
          payment_intent: intent,
          reason: "requested_by_customer",
          metadata: { order_id: String(id) },
        },
        { idempotencyKey: `refund-${order.checkoutSessionId}` },
      ),
    )
  } catch (error) {
    if (!alreadyRefunded(error)) {
      console.warn(`refund of ${orderNumber(id)} not confirmed: ${describe(error)}`)

      return { status: 502, body: { error: "Stripe did not confirm the refund yet. Try again." } }
    }
  }

  await query("mark order refunded", (db) =>
    db.update(orders).set({ status: "refunded", refundedAt: new Date() }).where(eq(orders.id, id)),
  )

  return { status: 200, body: { status: "refunded" } }
}

export const ordersApi = new Hono()
  .get("/orders", async (c) => {
    const email = z.email().safeParse(c.req.query("email"))

    if (!email.success) return c.json([])

    return c.json(
      await query("list orders", (db) => ordersWithLines(db, eq(orders.email, email.data))),
    )
  })
  .get("/orders/:id", async (c) => {
    const id = z.coerce.number().int().parse(c.req.param("id"))
    const [order] = await query("read order", (db) => ordersWithLines(db, eq(orders.id, id)))

    return order ? c.json(order) : c.json({ error: "No such order." }, 404)
  })
  .get("/admin/orders", async (c) =>
    c.json(await query("list orders", (db) => ordersWithLines(db))),
  )
  .post("/admin/orders/:id/refund", async (c) => {
    const outcome = await refund(z.coerce.number().int().parse(c.req.param("id")))

    return c.json(outcome.body, outcome.status)
  })
  .get("/admin/stock", async (c) => {
    const rows = await query("stock levels", (db) =>
      db
        .select({
          slug: products.slug,
          name: products.name,
          category: products.category,
          priceCents: products.priceCents,
          stock: products.stock,
          sold: sql<number>`coalesce((select sum(${orderItems.quantity}) from ${orderItems} where ${orderItems.productId} = ${products.id}), 0)::int`,
        })
        .from(products)
        .orderBy(asc(products.id)),
    )

    return c.json(rows)
  })
