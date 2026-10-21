/**
 * Starting a Stripe Checkout Session for a cart. The idempotency key is the cart and exactly what
 * is being bought, so a double-click, a retried request or a retry after a lost answer all get the
 * same session back from Stripe: one cart, one Checkout Session.
 */
import { createHash } from "node:crypto"

import { eq } from "drizzle-orm"
import { Hono } from "hono"
import type { Stripe } from "stripe"
import { z } from "zod"

import { cartView } from "./cart.ts"
import { query } from "./db/client.ts"
import { checkouts, orders } from "./db/schema.ts"
import { broken } from "./settings.ts"
import { stripe, stripeCall } from "./stripe.ts"

const StartCheckout = z.object({ email: z.email(), origin: z.url() })

/** The idempotency key for one checkout: the cart and a fingerprint of what Stripe is asked for. */
function idempotencyKey(cartId: string, params: Stripe.Checkout.SessionCreateParams): string {
  const fingerprint = createHash("sha256").update(JSON.stringify(params)).digest("hex")

  return `checkout-${cartId}-${fingerprint.slice(0, 16)}`
}

/** Why a cart cannot be paid for as it is, or undefined when it can. */
function problemWith(view: Awaited<ReturnType<typeof cartView>>): string | undefined {
  if (view.lines.length === 0) return "Your cart is empty."

  const short = view.lines.find((line) => line.quantity > line.stock)

  if (!short) return undefined

  return short.stock === 0
    ? `${short.name} is sold out.`
    : `Only ${short.stock} × ${short.name} left in stock.`
}

export const checkout = new Hono()
  .post("/carts/:id/checkout", async (c) => {
    const cartId = z.uuid().parse(c.req.param("id"))
    const { email, origin } = StartCheckout.parse(await c.req.json())
    const view = await query("read cart", (db) => cartView(db, cartId))
    const problem = problemWith(view)

    if (problem) return c.json({ error: problem }, 409)

    const params: Stripe.Checkout.SessionCreateParams = {
      mode: "payment",
      customer_email: email,
      client_reference_id: cartId,
      line_items: view.lines.map((line) => ({
        price: line.stripePriceId,
        quantity: line.quantity,
      })),
      metadata: { cart_id: cartId },
      success_url: `${origin}/orders/confirmed?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/cart`,
    }
    const options = broken("no-idempotency-key")
      ? {}
      : { idempotencyKey: idempotencyKey(cartId, params) }
    const session = await stripeCall("checkout.sessions.create", () =>
      stripe.checkout.sessions.create(params, options),
    )

    await query("record checkout", (db) =>
      db
        .insert(checkouts)
        .values({
          sessionId: session.id,
          cartId,
          email,
          lines: view.lines.map((line) => ({
            productId: line.productId,
            name: line.name,
            unitCents: line.unitCents,
            quantity: line.quantity,
          })),
          amountCents: view.totalCents,
        })
        .onConflictDoNothing(),
    )

    return c.json({ url: session.url })
  })
  /**
   * Where the confirmation page asks how a payment went: the order once the webhook made it,
   * else whether Stripe has taken the money yet.
   */
  .get("/checkout/sessions/:id", async (c) => {
    const sessionId = c.req.param("id")
    const [order] = await query("find order", (db) =>
      db
        .select({ id: orders.id })
        .from(orders)
        .where(eq(orders.checkoutSessionId, sessionId))
        .limit(1),
    )

    if (order) return c.json({ state: "ordered", orderId: order.id })

    const session = await stripeCall("checkout.sessions.retrieve", () =>
      stripe.checkout.sessions.retrieve(sessionId),
    )

    return c.json({ state: session.payment_status === "paid" ? "paid" : "unpaid" })
  })
