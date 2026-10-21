import type { Context } from "../../http.ts"
import type { StripeRouteContext } from "../context.ts"
import type { InvoiceItem, Price } from "../entities.ts"
import {
  asRecord,
  badParam,
  integer,
  listPage,
  metadataOf,
  newId,
  noSuch,
  readParams,
  text,
  textOrNull,
  unix,
} from "../helpers.ts"

/** What an invoice item costs: per unit and in all, in `currency`, and the price it came from. */
interface Cost {
  readonly unitAmount: number
  readonly amount: number
  readonly currency: string
  readonly price: Price | undefined
}

/**
 * The cost a create request asks for: `pricing[price]` (or the older `price`) and a quantity, a
 * `unit_amount_decimal` and a quantity, or a total `amount`, in the price's currency or the given
 * one. A response instead when the request names no cost, no currency or an unknown price.
 */
function costOf(
  context: StripeRouteContext,
  c: Context,
  params: Record<string, unknown>,
  quantity: number,
): Cost | Response {
  const priceId = text(asRecord(params.pricing)?.price) ?? text(params.price)

  if (priceId !== undefined) {
    const price = context.objects.prices.get(priceId)

    if (!price) return noSuch(c, "price", priceId, "pricing[price]")

    const unitAmount = price.unit_amount ?? 0

    return { unitAmount, amount: unitAmount * quantity, currency: price.currency, price }
  }

  const currency = text(params.currency)

  if (currency === undefined) return badParam(c, "currency")

  const unit = Number(text(params.unit_amount_decimal) ?? Number.NaN)

  if (Number.isFinite(unit))
    return { unitAmount: unit, amount: Math.round(unit * quantity), currency, price: undefined }

  const amount = integer(params.amount)

  if (amount === undefined) return badParam(c, "amount")

  return { unitAmount: amount / quantity, amount, currency, price: undefined }
}

function invoiceItemObject(
  context: StripeRouteContext,
  params: Record<string, unknown>,
  customer: string,
  quantity: number,
  cost: Cost,
): InvoiceItem {
  const now = unix(context.clock())
  const period = asRecord(params.period)

  return {
    id: newId("ii"),
    object: "invoiceitem",
    amount: cost.amount,
    currency: cost.currency.toLowerCase(),
    customer,
    customer_account: null,
    date: now,
    description: textOrNull(params.description),
    discountable: true,
    discounts: [],
    invoice: textOrNull(params.invoice),
    livemode: false,
    metadata: metadataOf(params.metadata) ?? {},
    parent: null,
    period: {
      start: integer(period?.start) ?? now,
      end: integer(period?.end) ?? now,
    },
    pricing: {
      type: "price_details",
      ...(cost.price && {
        price_details: {
          price: cost.price.id,
          product: typeof cost.price.product === "string" ? cost.price.product : "",
        },
      }),
      unit_amount_decimal: String(cost.unitAmount),
    },
    proration: false,
    quantity,
    quantity_decimal: String(quantity),
    tax_rates: [],
    test_clock: null,
  }
}

async function createInvoiceItem(context: StripeRouteContext, c: Context): Promise<Response> {
  const params = await readParams(c)
  const customer = text(params.customer)

  if (customer === undefined) return badParam(c, "customer")
  if (!context.objects.customers.get(customer)) return noSuch(c, "customer", customer, "customer")

  const quantity = integer(params.quantity) ?? 1

  if (quantity < 1) return badParam(c, "quantity", "This value must be greater than or equal to 1.")

  const cost = costOf(context, c, params, quantity)

  if (cost instanceof Response) return cost

  const item = context.objects.invoiceItems.add(
    invoiceItemObject(context, params, customer, quantity, cost),
    null,
  )

  context.events.emit("invoiceitem.created", item)

  return c.json(item)
}

/**
 * Invoice items: one-off charges a customer's next invoice picks up, which is how an app bills
 * usage it counts itself. Create, retrieve and list them; they stay pending (no `invoice`).
 */
export function invoiceItemRoutes(context: StripeRouteContext): void {
  const { app, objects } = context

  app.post("/v1/invoiceitems", (c) => createInvoiceItem(context, c))

  app.get("/v1/invoiceitems/:id", (c) => {
    const id = c.req.param("id")
    const item = objects.invoiceItems.get(id)

    return item ? c.json(item) : noSuch(c, "invoiceitem", id)
  })

  app.get("/v1/invoiceitems", (c) => {
    const customer = c.req.query("customer")
    const pending = c.req.query("pending")

    return listPage(
      c,
      objects.invoiceItems.where(
        (item) =>
          (customer === undefined || item.customer === customer) &&
          (pending !== "true" || item.invoice === null),
      ),
      "/v1/invoiceitems",
    )
  })
}
