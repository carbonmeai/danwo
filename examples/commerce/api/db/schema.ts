/**
 * The shop's tables. `drizzle-kit push` creates them from this file; there are no migration files
 * to keep in step.
 */
import {
  integer,
  jsonb,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core"

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow()

export const products = pgTable("products", {
  id: serial().primaryKey(),
  slug: text().notNull().unique(),
  name: text().notNull(),
  category: text().notNull(),
  description: text().notNull(),
  priceCents: integer("price_cents").notNull(),
  currency: text().notNull().default("usd"),
  /** The Stripe price Checkout charges for it. */
  stripePriceId: text("stripe_price_id").notNull(),
  /** Its picture's key in the images bucket. */
  imageKey: text("image_key").notNull(),
  stock: integer().notNull(),
})

export const carts = pgTable("carts", {
  id: uuid().primaryKey().defaultRandom(),
  createdAt: createdAt(),
})

export const cartItems = pgTable(
  "cart_items",
  {
    cartId: uuid("cart_id")
      .notNull()
      .references(() => carts.id, { onDelete: "cascade" }),
    productId: integer("product_id")
      .notNull()
      .references(() => products.id),
    quantity: integer().notNull(),
  },
  (table) => [primaryKey({ columns: [table.cartId, table.productId] })],
)

/** One line of a checkout, as the cart held it when the customer went to pay. */
export interface CheckoutLine {
  readonly productId: number
  readonly name: string
  readonly unitCents: number
  readonly quantity: number
}

/** A Stripe Checkout Session the shop started, with what it is for. */
export const checkouts = pgTable("checkouts", {
  sessionId: text("session_id").primaryKey(),
  cartId: uuid("cart_id").notNull(),
  email: text().notNull(),
  lines: jsonb().$type<readonly CheckoutLine[]>().notNull(),
  amountCents: integer("amount_cents").notNull(),
  createdAt: createdAt(),
})

export type OrderStatus = "paid" | "refunding" | "refunded"

export const orders = pgTable(
  "orders",
  {
    id: serial().primaryKey(),
    checkoutSessionId: text("checkout_session_id").notNull(),
    paymentIntentId: text("payment_intent_id"),
    email: text().notNull(),
    totalCents: integer("total_cents").notNull(),
    currency: text().notNull(),
    status: text().$type<OrderStatus>().notNull().default("paid"),
    /** The id Resend gave the receipt; empty until it was sent. */
    receiptEmailId: text("receipt_email_id"),
    createdAt: createdAt(),
    refundedAt: timestamp("refunded_at", { withTimezone: true }),
  },
  /*
   * One order per paid Checkout Session, whatever Stripe sends twice. COMMERCE_BUG=no-webhook-dedupe
   * drops this guard together with the event log's, to show what the fault matrix then finds.
   */
  (table) =>
    process.env.COMMERCE_BUG === "no-webhook-dedupe"
      ? []
      : [uniqueIndex("orders_checkout_session_id").on(table.checkoutSessionId)],
)

export const orderItems = pgTable(
  "order_items",
  {
    orderId: integer("order_id")
      .notNull()
      .references(() => orders.id),
    productId: integer("product_id")
      .notNull()
      .references(() => products.id),
    name: text().notNull(),
    unitCents: integer("unit_cents").notNull(),
    quantity: integer().notNull(),
  },
  (table) => [primaryKey({ columns: [table.orderId, table.productId] })],
)

/** Every Stripe event the shop has acted on, so a repeat delivery is recognised and skipped. */
export const webhookEvents = pgTable("webhook_events", {
  id: text().primaryKey(),
  type: text().notNull(),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
})
