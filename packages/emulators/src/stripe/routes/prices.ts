import { isOneOf } from "../../json.ts"
import type { StripeRouteContext } from "../context.ts"
import type { Price } from "../entities.ts"
import { priceObject, productObject } from "../formatters.ts"
import {
  asRecord,
  badParam,
  flag,
  integer,
  items,
  listPage,
  mergeMetadata,
  metadataOf,
  newId,
  noSuch,
  readParams,
  text,
  textOrNull,
  unix,
} from "../helpers.ts"

type Prices = Pick<StripeRouteContext, "objects" | "events" | "clock">
type Interval = "day" | "week" | "month" | "year"
type TaxBehavior = "exclusive" | "inclusive" | "unspecified"

const INTERVALS: readonly Interval[] = ["day", "week", "month", "year"]
const TAX_BEHAVIORS: readonly TaxBehavior[] = ["exclusive", "inclusive", "unspecified"]

/** `recurring[interval]=month&recurring[interval_count]=3`, or `null` for a one-time price. */
function recurringOf(value: unknown): { interval: Interval; interval_count: number } | null {
  const recurring = asRecord(value)
  const interval = recurring?.interval

  if (!isOneOf(INTERVALS, interval)) return null

  return { interval, interval_count: integer(recurring?.interval_count) ?? 1 }
}

/** `unit_amount`, or a whole-cent `unit_amount_decimal`. */
function amountOf(params: Record<string, unknown>): number | undefined {
  return (
    integer(params.unit_amount) ??
    integer(Number.parseFloat(text(params.unit_amount_decimal) ?? ""))
  )
}

function taxBehaviorOf(value: unknown): TaxBehavior | null {
  return isOneOf(TAX_BEHAVIORS, value) ? value : null
}

/** The product a price belongs to: an existing id, or a new one from `product_data`. */
function productFor(prices: Prices, params: Record<string, unknown>): string | undefined {
  const id = text(params.product)

  if (id) return prices.objects.products.get(id)?.id

  const data = asRecord(params.product_data)
  const name = text(data?.name)

  if (!name) return undefined

  const product = prices.objects.products.add(
    productObject({
      id: newId("prod"),
      created: unix(prices.clock()),
      name,
      description: null,
      active: true,
      metadata: metadataOf(data?.metadata) ?? {},
    }),
    null,
  )

  prices.events.emit("product.created", product)

  return product.id
}

/**
 * Creates a price from `price_data`-style fields (`product` or `product_data`, `currency`,
 * `unit_amount`, `recurring`), as `POST /v1/prices` and Checkout's inline prices both do.
 * Returns the parameter at fault when one is missing or unknown.
 */
export function createPrice(
  prices: Prices,
  params: Record<string, unknown>,
): Price | { readonly missing: string } {
  const currency = text(params.currency)?.toLowerCase()
  const amount = amountOf(params)

  if (!currency) return { missing: "currency" }
  if (amount === undefined) return { missing: "unit_amount" }

  const product = productFor(prices, params)

  if (!product) return { missing: "product" }

  const price = prices.objects.prices.add(
    priceObject({
      id: newId("price"),
      created: unix(prices.clock()),
      product,
      currency,
      unitAmount: amount,
      active: flag(params.active) ?? true,
      nickname: textOrNull(params.nickname),
      lookupKey: textOrNull(params.lookup_key),
      taxBehavior: taxBehaviorOf(params.tax_behavior),
      recurring: recurringOf(params.recurring),
      metadata: metadataOf(params.metadata) ?? {},
    }),
    null,
  )

  prices.events.emit("price.created", price)

  return price
}

/** Prices: create, retrieve, update and list. */
export function priceRoutes(context: StripeRouteContext): void {
  const { app, objects, events } = context
  const { prices } = objects

  app.post("/v1/prices", async (c) => {
    const params = await readParams(c)
    const product = text(params.product)

    if (product && !objects.products.get(product)) return noSuch(c, "product", product, "product")

    const price = createPrice(context, params)

    return "missing" in price ? badParam(c, price.missing) : c.json(price)
  })

  app.get("/v1/prices/:id", (c) => {
    const id = c.req.param("id")
    const price = prices.get(id)

    return price ? c.json(price) : noSuch(c, "price", id)
  })

  app.post("/v1/prices/:id", async (c) => {
    const id = c.req.param("id")
    const current = prices.get(id)

    if (!current) return noSuch(c, "price", id)

    const params = await readParams(c)
    const active = flag(params.active)
    const updated = prices.change(id, {
      ...(active !== undefined && { active }),
      ...(params.nickname !== undefined && { nickname: text(params.nickname) || null }),
      ...(params.lookup_key !== undefined && { lookup_key: text(params.lookup_key) || null }),
      metadata: mergeMetadata(current.metadata, metadataOf(params.metadata)),
    })

    if (updated) events.emit("price.updated", updated)

    return c.json(updated)
  })

  app.get("/v1/prices", async (c) => {
    const params = await readParams(c)
    const product = text(params.product)
    const active = flag(params.active)
    const type = text(params.type)
    const lookupKeys = items(params.lookup_keys).filter((key) => typeof key === "string")

    return listPage(
      c,
      prices.where(
        (price) =>
          (product === undefined || price.product === product) &&
          (active === undefined || price.active === active) &&
          (type === undefined || price.type === type) &&
          (lookupKeys.length === 0 || lookupKeys.includes(price.lookup_key ?? "")),
      ),
      "/v1/prices",
    )
  })
}
