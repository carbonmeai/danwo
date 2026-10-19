import { isRecord } from "../../json.ts"
import type { BachsContext } from "../context.ts"
import { matchOrCreateCustomer } from "../customers.ts"
import { checkEmail } from "../emails.ts"
import type { CheckoutLine, CheckoutSession, Customer, Product } from "../entities.ts"
import { checkoutObject, createdCheckoutObject } from "../formatters.ts"
import {
  bachsId,
  BachsFailure,
  bodyOf,
  hex,
  invalid,
  iso,
  later,
  listPage,
  metadataOf,
  notFound,
  text,
} from "../helpers.ts"
import { priceOf } from "../pricing.ts"

/** The payment-method corridors that can charge each currency. */
const CORRIDORS: Readonly<Record<string, readonly string[]>> = {
  USD: ["USD_CARD", "CRYPTO"],
  NGN: ["NGN_CARD", "NGN_BANK_TRANSFER"],
}

/** A product a cart may sell: it exists and is not archived. */
function sellable(context: BachsContext, productId: string | undefined): Product {
  const product = productId ? context.bachs.products.get(productId) : undefined

  if (!product)
    throw new BachsFailure(400, "PRODUCT_NOT_FOUND", `Product ${productId ?? ""} not found`)
  if (product.archivedAt)
    throw new BachsFailure(400, "PRODUCT_ARCHIVED", `Product ${product.id} is archived`)

  return product
}

/** A cart item's quantity: 1 when absent, otherwise a positive integer. */
function quantityOf(item: Record<string, unknown>): number {
  const quantity = item["quantity"] ?? 1

  if (typeof quantity !== "number" || !Number.isInteger(quantity) || quantity < 1)
    invalid("quantity must be a positive integer")

  return quantity
}

/** One cart item as a checkout line, priced from the catalog or the item's override. */
function cartLine(context: BachsContext, item: unknown): CheckoutLine {
  if (!isRecord(item)) invalid("product_cart items must be objects")

  const product = sellable(context, text(item, "product_id"))
  const override = item["pricing"]

  return {
    productId: product.id,
    name: product.name,
    quantity: quantityOf(item),
    price: isRecord(override) ? priceOf(override, product.price.currency) : product.price,
    recurring: product.billingCycle !== null,
  }
}

/** The lines a checkout charges for: catalog products, or a raw `pricing` amount with no product. */
function linesOf(context: BachsContext, body: Record<string, unknown>): CheckoutLine[] {
  const cart = body["product_cart"]
  const pricing = body["pricing"]

  if ((cart === undefined) === (pricing === undefined))
    invalid("Provide exactly one pricing source: product_cart or pricing")
  if (pricing !== undefined)
    return [
      { productId: null, name: "Payment", quantity: 1, price: priceOf(pricing), recurring: false },
    ]
  if (!Array.isArray(cart) || cart.length === 0)
    invalid("product_cart must list at least one product")

  const lines = cart.map((item) => cartLine(context, item))

  if (new Set(lines.map((line) => line.price.currency)).size > 1)
    throw new BachsFailure(
      400,
      "CART_CURRENCY_MISMATCH",
      "All products in the cart must share the same currency",
    )

  return lines
}

/** A new customer's email from a checkout's `customer`, refusing one Bachs would not keep. */
function emailOf(value: Record<string, unknown>): string {
  const email = text(value, "email")

  if (!email)
    invalid("customer.email must be a valid email", {
      field: "customer.email",
      message: "Invalid email",
      type: "value_error",
    })
  checkEmail(email)

  return email
}

/** The customer a checkout is created for: an existing id, or an email matched or created. */
function customerOf(context: BachsContext, value: unknown): Customer | null {
  if (value === undefined || value === null) return null
  if (!isRecord(value)) invalid("customer must be an object")

  const id = text(value, "customer_id")

  if (id) return context.bachs.customers.get(id) ?? notFound("Customer")

  return matchOrCreateCustomer(context, {
    email: emailOf(value),
    name: text(value, "name") ?? null,
    phoneNumber: text(value, "phone_number") ?? null,
  })
}

/** Checks the session-wide options that can refuse a checkout: reference, currency, methods. */
function checkOptions(
  context: BachsContext,
  body: Record<string, unknown>,
  currency: string,
): void {
  const reference = text(body, "reference")

  if (
    reference &&
    context.bachs.checkouts.where((checkout) => checkout.reference === reference).length > 0
  )
    throw new BachsFailure(409, "CONFLICT", "A checkout with this reference already exists")

  const billing = text(body, "billing_currency")

  if (billing && billing.toUpperCase() !== currency)
    throw new BachsFailure(
      422,
      "BILLING_CURRENCY_NOT_AVAILABLE",
      `The checkout is not priced in ${billing}`,
    )

  const methods = body["payment_method_types"]

  if (
    Array.isArray(methods) &&
    !methods.some((method) => (CORRIDORS[currency] ?? []).includes(String(method)))
  )
    throw new BachsFailure(
      400,
      "CHECKOUT_RESTRICTION_LEAVES_NO_PAYMENT_METHOD",
      "The restriction leaves no payment method for this checkout",
    )
}

function expiryMinutes(body: Record<string, unknown>): number {
  const minutes = body["expires_in_minutes"] ?? 60

  if (typeof minutes !== "number" || !Number.isInteger(minutes) || minutes < 1 || minutes > 1440)
    invalid("expires_in_minutes must be between 1 and 1440")

  return minutes
}

/** A checkout from a create request, before it is stored. */
/** Where the buyer is sent and what the app attached: URLs, reference, metadata, creation rule. */
function checkoutOptions(body: Record<string, unknown>) {
  return {
    customerCreation:
      body["customer_creation"] === "always" ? ("always" as const) : ("if_required" as const),
    reference: text(body, "reference") ?? null,
    metadata: metadataOf(body["metadata"]),
    successUrl: text(body, "success_url") ?? null,
    cancelUrl: text(body, "cancel_url") ?? null,
  }
}

function newCheckout(context: BachsContext, body: Record<string, unknown>): CheckoutSession {
  const lines = linesOf(context, body)
  const currency = lines[0]?.price.currency ?? "USD"
  const subscription = lines.some((line) => line.recurring)

  checkOptions(context, body, currency)
  if (subscription && body["customer"] === undefined)
    invalid("customer is required for a subscription checkout", {
      field: "customer",
      message: "Field required",
      type: "missing",
    })

  const customer = customerOf(context, body["customer"])
  const now = context.clock()

  return {
    id: bachsId("chk", 16),
    token: hex(12),
    status: "open",
    mode: subscription ? "subscription" : "payment",
    currency,
    lines,
    customerId: customer?.id ?? null,
    customerDetails: customer ? { email: customer.email, name: customer.name } : null,
    ...checkoutOptions(body),
    paymentId: null,
    subscriptionId: null,
    chosenAmount: null,
    createdAt: iso(now),
    expiresAt: iso(later(now, expiryMinutes(body) * 60_000)),
    completedAt: null,
    updatedAt: iso(now),
  }
}

/** Checkout sessions: create one and get its hosted URL, retrieve it, list them. */
export function checkoutSessionRoutes(context: BachsContext): void {
  const { app, bachs } = context

  app.post("/v1/checkout-sessions", async (c) => {
    const checkout = bachs.checkouts.add(newCheckout(context, await bodyOf(c)), null)

    context.wakeAt(new Date(checkout.expiresAt))

    return c.json(createdCheckoutObject(checkout), 201)
  })

  app.get("/v1/checkout-sessions/:id", (c) => {
    const checkout = bachs.checkouts.get(c.req.param("id")) ?? notFound("Checkout session")

    return c.json(checkoutObject(checkout, bachs))
  })

  app.get("/v1/checkout-sessions", (c) =>
    c.json(
      listPage(
        c,
        bachs.checkouts
          .all()
          .toReversed()
          .map((checkout) => checkoutObject(checkout, bachs)),
      ),
    ),
  )
}
