/**
 * Carts: a guest's basket, kept in the database under an id the storefront holds in a cookie.
 */
import { and, asc, eq, sql } from "drizzle-orm"
import { Hono } from "hono"
import { z } from "zod"

import { type Database, query, transaction, type Transaction } from "./db/client.ts"
import { cartItems, carts, products } from "./db/schema.ts"

/** A cart as the storefront shows it, with each line's product and the total. */
export async function cartView(db: Database | Transaction, cartId: string) {
  const rows = await db
    .select({
      slug: products.slug,
      name: products.name,
      productId: products.id,
      unitCents: products.priceCents,
      stripePriceId: products.stripePriceId,
      stock: products.stock,
      quantity: cartItems.quantity,
    })
    .from(cartItems)
    .innerJoin(products, eq(products.id, cartItems.productId))
    .where(eq(cartItems.cartId, cartId))
    .orderBy(asc(products.id))

  return {
    id: cartId,
    lines: rows,
    totalCents: rows.reduce((sum, line) => sum + line.unitCents * line.quantity, 0),
  }
}

const AddItem = z.object({ slug: z.string(), quantity: z.coerce.number().int().min(1).max(10) })
const SetQuantity = z.object({ quantity: z.coerce.number().int().min(0).max(10) })
const CartId = z.uuid()

/** The storefront picks a cart's id (a UUID in its cookie); the first item added creates the cart. */
export const cart = new Hono()
  .get("/carts/:id", async (c) => {
    const id = CartId.safeParse(c.req.param("id"))

    if (!id.success) return c.json({ id: c.req.param("id"), lines: [], totalCents: 0 })

    return c.json(await query("read cart", (db) => cartView(db, id.data)))
  })
  .post("/carts/:id/items", async (c) => {
    const id = CartId.parse(c.req.param("id"))
    const { slug, quantity } = AddItem.parse(await c.req.json())
    const added = await transaction("add to cart", async (tx) => {
      const [product] = await tx.select().from(products).where(eq(products.slug, slug))

      if (!product) return undefined

      await tx.insert(carts).values({ id }).onConflictDoNothing()
      await tx
        .insert(cartItems)
        .values({ cartId: id, productId: product.id, quantity })
        .onConflictDoUpdate({
          target: [cartItems.cartId, cartItems.productId],
          set: { quantity: sql`least(${cartItems.quantity} + ${quantity}, 10)` },
        })

      return cartView(tx, id)
    })

    return added ? c.json(added) : c.json({ error: "no such product" }, 404)
  })
  .put("/carts/:id/items/:slug", async (c) => {
    const id = CartId.parse(c.req.param("id"))
    const { quantity } = SetQuantity.parse(await c.req.json())
    const updated = await transaction("change cart", async (tx) => {
      const [product] = await tx
        .select({ id: products.id })
        .from(products)
        .where(eq(products.slug, c.req.param("slug")))

      if (!product) return undefined

      const line = and(eq(cartItems.cartId, id), eq(cartItems.productId, product.id))

      await (quantity === 0
        ? tx.delete(cartItems).where(line)
        : tx.update(cartItems).set({ quantity }).where(line))

      return cartView(tx, id)
    })

    return updated ? c.json(updated) : c.json({ error: "no such product" }, 404)
  })
