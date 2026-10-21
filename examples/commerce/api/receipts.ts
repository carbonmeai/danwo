/**
 * Receipt emails, sent through Resend once an order exists. The idempotency key is the order's
 * Checkout Session, so a retry after a timeout or a lost answer never sends a second email. A
 * receipt that still fails is tried again in the background: the order is safe in the database
 * either way.
 */
import { asc, eq, isNull } from "drizzle-orm"
import { Resend } from "resend"

import { query } from "./db/client.ts"
import { orderItems, orders } from "./db/schema.ts"
import { describe, retrying, TimeoutError, withTimeout } from "./retry.ts"
import { settings } from "./settings.ts"

const resend = new Resend(settings.RESEND_API_KEY)

/** `1800` as `$18.00`. */
export function money(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`
}

/** The number a customer sees for an order. */
export function orderNumber(id: number): string {
  return `PC-${1000 + id}`
}

/** What Resend answered instead of an email id. */
class ResendFailure extends Error {
  override readonly name = "ResendFailure"
  readonly kind: string

  constructor(kind: string, message: string) {
    super(`${kind}: ${message}`)
    this.kind = kind
  }
}

/** Failures that a later attempt can get past; a bad address or payload never will. */
const TRANSIENT = new Set([
  "rate_limit_exceeded",
  "application_error",
  "internal_server_error",
  "concurrent_idempotent_requests",
])

function retryable(error: unknown): boolean {
  return (
    error instanceof TimeoutError || (error instanceof ResendFailure && TRANSIENT.has(error.kind))
  )
}

/** The receipt for one order, the same text on every attempt so the idempotency key holds. */
async function receiptFor(orderId: number) {
  const [order] = await query("read order", (db) =>
    db.select().from(orders).where(eq(orders.id, orderId)),
  )

  if (!order) return undefined

  const lines = await query("read order lines", (db) =>
    db
      .select()
      .from(orderItems)
      .where(eq(orderItems.orderId, orderId))
      .orderBy(asc(orderItems.productId)),
  )
  const number = orderNumber(order.id)
  const rows = lines.map(
    (line) => `${line.quantity} × ${line.name}  ${money(line.unitCents * line.quantity)}`,
  )

  return {
    order,
    email: {
      from: settings.MAIL_FROM,
      to: order.email,
      subject: `Your Paper & Clay order ${number}`,
      text: [
        `Thank you for your order ${number}.`,
        "",
        ...rows,
        "",
        `Total ${money(order.totalCents)}`,
      ].join("\n"),
      html: `<h1>Thank you for your order ${number}</h1><ul>${rows.map((row) => `<li>${row}</li>`).join("")}</ul><p><strong>Total ${money(order.totalCents)}</strong></p>`,
    },
  }
}

/** Sends one order's receipt unless it was sent already; throws when Resend would not take it. */
export async function sendReceipt(orderId: number): Promise<void> {
  const receipt = await receiptFor(orderId)

  if (!receipt || receipt.order.receiptEmailId) return

  const sent = await retrying(
    {
      name: `resend receipt ${orderNumber(orderId)}`,
      attempts: 4,
      retryable,
      delayMs: (attempt, error) =>
        error instanceof ResendFailure && error.kind === "rate_limit_exceeded"
          ? 1_000
          : 200 * attempt,
    },
    async () => {
      const { data, error } = await withTimeout(
        resend.emails.send(receipt.email, {
          idempotencyKey: `receipt-${receipt.order.checkoutSessionId}`,
        }),
        4_000,
        "resend emails.send",
      )

      if (error) throw new ResendFailure(error.name, error.message)

      return data
    },
  )

  await query("note receipt", (db) =>
    db.update(orders).set({ receiptEmailId: sent.id }).where(eq(orders.id, orderId)),
  )
}

/** How long to wait before each later try at a receipt that failed: about half a minute in all. */
const LATER_MS = [1_000, 2_000, 4_000, 8_000, 15_000]

/**
 * Sends a receipt now if it can; when Resend still refuses, tries again in the background, a
 * little later each time. The order is committed already, so the customer is never left without
 * one because the mail provider had a bad minute.
 */
export async function sendReceiptSoon(orderId: number, attempt = 0): Promise<void> {
  try {
    await sendReceipt(orderId)
  } catch (error) {
    const wait = LATER_MS[attempt]

    if (wait === undefined) {
      console.error(`receipt ${orderNumber(orderId)} not sent: ${describe(error)}`)

      return
    }

    console.warn(`receipt ${orderNumber(orderId)}: trying again in ${wait} ms (${describe(error)})`)
    setTimeout(() => void sendReceiptSoon(orderId, attempt + 1), wait).unref()
  }
}

/** On start-up, sends the receipts a stopped API never got to. */
export async function sendMissedReceipts(): Promise<void> {
  const rows = await query("find unsent receipts", (db) =>
    db.select({ id: orders.id }).from(orders).where(isNull(orders.receiptEmailId)),
  )

  for (const row of rows) await sendReceiptSoon(row.id)
}
