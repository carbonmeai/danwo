/**
 * What the shop's tests share: buying something through the storefront and Stripe's hosted page,
 * and the invariants. Each invariant reads one fact from two sides, the shop's database and the
 * provider's emulator, and must hold however a trial went: paid, declined, retried or faulted.
 */
import {
  type DanwoFixtures,
  type Emulator,
  type InboxEmail,
  type ResendFixtures,
  resendInbox,
  type StripeFixtures,
  z,
} from "@danwo/sdk"

import { CATALOG, seededStock } from "../seed/catalog.ts"
import type { Sql } from "./db.ts"

/** The returning customer's email. */
export const CUSTOMER = "ada@paperandclay.test"

/** What every shop test receives: the emulators, and SQL on this worker's database. */
export type ShopFixtures = StripeFixtures & ResendFixtures & { readonly sql: Sql }

/** Stripe's declining test card. */
export const DECLINED_CARD = "4000 0000 0000 0002"

/**
 * Buys `quantity` of `product` as `email`: the product page, the cart, then Stripe's page, paying
 * with `card` (Stripe's Visa test card unless given). It stops once Pay is pressed.
 */
export async function pay(
  { app, screen, expect }: Pick<DanwoFixtures, "app" | "screen" | "expect">,
  purchase: {
    readonly product: string
    readonly email: string
    readonly quantity?: number
    readonly card?: string
  },
): Promise<void> {
  await app.open(`/products/${purchase.product}`)
  if (purchase.quantity !== undefined)
    await screen.getByLabel("Quantity").selectOption(String(purchase.quantity))
  await screen.getByRole("button", { name: "Add to cart" }).click()
  await expect(screen.getByRole("heading", { name: "Your cart" })).toBeVisible()
  await screen.getByLabel("Email for your receipt").fill(purchase.email)
  await screen.getByRole("button", { name: "Checkout" }).click()
  await expect(screen.getByTestId("checkout-total")).toBeVisible()
  if (purchase.card) await screen.getByLabel("Card number").fill(purchase.card)
  await screen.getByTestId("checkout-pay").click()
}

/** `pay`, then waits for the order confirmation. */
export async function buy(
  fixtures: Pick<DanwoFixtures, "app" | "screen" | "expect">,
  purchase: { readonly product: string; readonly email: string; readonly quantity?: number },
): Promise<void> {
  await pay(fixtures, purchase)
  await fixtures
    .expect(fixtures.screen.getByRole("heading", { name: "Thank you for your order" }))
    .toBeVisible()
}

const Sessions = z.object({
  data: z.array(
    z.object({
      id: z.string(),
      client_reference_id: z.string().nullable(),
      payment_status: z.string(),
      amount_total: z.number().nullable(),
    }),
  ),
})
const Charges = z.object({
  data: z.array(
    z.object({
      payment_intent: z.string().nullable(),
      refunded: z.boolean(),
      amount_refunded: z.number(),
    }),
  ),
})

/** One page of a Stripe list, read from the emulator the way the shop's own client would. */
async function stripeList(stripe: Emulator, path: string): Promise<unknown> {
  const res = await stripe.fetch(
    new Request(`https://api.stripe.com/v1/${path}`, {
      headers: { authorization: "Bearer sk_test_paper_and_clay" },
    }),
  )

  return res.json()
}

interface OrderRow {
  readonly id: number
  readonly checkout_session_id: string
  readonly payment_intent_id: string | null
  readonly email: string
  readonly total_cents: number
  readonly status: string
  readonly lines_cents: number
}

/** The shop's orders, each with what its lines add up to. */
function ordersOf(sql: Sql): Promise<OrderRow[]> {
  return sql<OrderRow>(
    `select o.id, o.checkout_session_id, o.payment_intent_id, o.email, o.total_cents, o.status,
            coalesce((select sum(i.unit_cents * i.quantity) from order_items i where i.order_id = o.id), 0)::int as lines_cents
       from orders o order by o.id`,
  )
}

/** The receipts Resend accepted for `orders`, waiting a little for any still being retried. */
async function receiptsFor(resend: Emulator, orders: readonly OrderRow[]): Promise<InboxEmail[]> {
  const deadline = Date.now() + 20_000
  const receipts = () =>
    resendInbox(resend)
      .list()
      .filter((email) => email.subject.startsWith("Your Paper & Clay order"))

  while (receipts().length < orders.length && Date.now() < deadline)
    await new Promise((resolve) => setTimeout(resolve, 200))

  return receipts()
}

/** The number a customer sees for an order. */
export function orderNumber(id: number): string {
  return `PC-${1000 + id}`
}

/**
 * The shop's books balance with Stripe's and Resend's:
 * - exactly one order per paid Checkout Session, and none for an unpaid one;
 * - each order's total is what Stripe charged, and what its lines add up to;
 * - stock went down exactly once per order, by what the orders hold;
 * - exactly one receipt email per order, to the address that paid;
 * - an order is refunded exactly when Stripe shows its charge refunded.
 */
export async function expectBooksBalance({
  sql,
  stripe,
  resend,
  expect,
}: ShopFixtures & Pick<DanwoFixtures, "expect">): Promise<void> {
  const orders = await ordersOf(sql)
  const sessions = Sessions.parse(await stripeList(stripe, "checkout/sessions?limit=100")).data
  const paid = sessions.filter((session) => session.payment_status === "paid")

  expect(
    orders.map((order) => order.checkout_session_id).toSorted(),
    "one order per paid Checkout Session",
  ).toEqual(paid.map((session) => session.id).toSorted())

  for (const order of orders) {
    const session = paid.find((s) => s.id === order.checkout_session_id)

    expect(order.total_cents, `${orderNumber(order.id)} total is what Stripe charged`).toBe(
      session?.amount_total,
    )
    expect(order.lines_cents, `${orderNumber(order.id)} total is what its lines add up to`).toBe(
      order.total_cents,
    )
  }

  const stock = await sql<{ slug: string; stock: number; sold: number }>(
    `select p.slug, p.stock,
            coalesce((select sum(i.quantity) from order_items i where i.product_id = p.id), 0)::int as sold
       from products p`,
  )

  for (const product of stock)
    expect(
      seededStock(product.slug) - product.stock,
      `${product.slug}: stock taken once per order`,
    ).toBe(product.sold)
  expect(stock).toHaveLength(CATALOG.length)

  const receipts = await receiptsFor(resend, orders)

  expect(receipts, "one receipt per order").toHaveLength(orders.length)
  for (const order of orders)
    expect(
      receipts.filter(
        (email) => email.subject.endsWith(orderNumber(order.id)) && email.to.includes(order.email),
      ),
      `one receipt for ${orderNumber(order.id)}`,
    ).toHaveLength(1)

  const charges = Charges.parse(await stripeList(stripe, "charges?limit=100")).data

  for (const order of orders) {
    const charge = charges.find((c) => c.payment_intent === order.payment_intent_id)

    expect(order.status === "refunded", `${orderNumber(order.id)} refunded as Stripe says`).toBe(
      charge?.refunded ?? false,
    )
  }
}

/**
 * One Checkout Session per cart and amount: a double-click, a retried request or a retry after a
 * lost answer must get the cart's session back, never start a second one the customer could pay.
 */
export async function expectOneSessionPerCart({
  stripe,
  expect,
}: ShopFixtures & Pick<DanwoFixtures, "expect">): Promise<void> {
  const sessions = Sessions.parse(await stripeList(stripe, "checkout/sessions?limit=100")).data
  const keys = sessions.map((session) => `${session.client_reference_id} ${session.amount_total}`)

  expect(keys, "one Checkout Session per cart").toEqual([...new Set(keys)])
}
