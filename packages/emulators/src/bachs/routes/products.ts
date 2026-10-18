import type { BachsContext } from "../context.ts"
import type { Product } from "../entities.ts"
import { productObject } from "../formatters.ts"
import {
  BachsFailure,
  bachsId,
  bodyOf,
  type Changes,
  invalid,
  iso,
  listPage,
  metadataOf,
  notFound,
  text,
} from "../helpers.ts"
import { cadenceOf, priceOf } from "../pricing.ts"

/** A product from a create request, before it is stored. */
function newProduct(context: BachsContext, body: Record<string, unknown>): Product {
  const name = text(body, "name")

  if (!name?.trim())
    invalid("Missing required field(s): name", {
      field: "name",
      message: "Field required",
      type: "missing",
    })

  const billingCycle = cadenceOf(body["billing_cycle"], "billing_cycle")
  const trialPeriod = cadenceOf(body["trial_period"], "trial_period")

  if (trialPeriod && !billingCycle)
    throw new BachsFailure(
      400,
      "TRIAL_REQUIRES_RECURRING",
      "A trial is only valid on a recurring product",
    )

  const now = iso(context.clock())

  return {
    id: bachsId("prod", 20),
    name,
    description: text(body, "description") ?? null,
    price: priceOf(body["price"]),
    billingCycle,
    trialPeriod,
    metadata: metadataOf(body["metadata"]),
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
  }
}

/** What a PATCH may change; a recurring product's cadence is fixed once set. */
function productChanges(product: Product, body: Record<string, unknown>): Changes<Product> {
  const changes: Changes<Product> = {}
  const name = text(body, "name")

  if (name !== undefined) changes.name = name
  if ("description" in body) changes.description = text(body, "description") ?? null
  if ("price" in body) changes.price = priceOf(body["price"], product.price.currency)
  if ("metadata" in body) changes.metadata = metadataOf(body["metadata"])

  if ("billing_cycle" in body) {
    if (product.billingCycle)
      throw new BachsFailure(
        400,
        "RECURRING_INTERVAL_IMMUTABLE",
        "A product's billing cycle cannot change once set",
      )

    changes.billingCycle = cadenceOf(body["billing_cycle"], "billing_cycle")
  }

  if ("trial_period" in body) changes.trialPeriod = cadenceOf(body["trial_period"], "trial_period")

  return changes
}

/** Products: create, retrieve, update, list, archive and unarchive. */
export function productRoutes(context: BachsContext): void {
  const { app, bachs } = context
  const organization = () => bachs.organization()
  const found = (id: string) => bachs.products.get(id) ?? notFound("Product")
  const answer = (product: Product, status = 200) => ({
    body: productObject(product, organization()),
    status,
  })

  app.post("/v1/products", async (c) => {
    const { body, status } = answer(
      bachs.products.add(newProduct(context, await bodyOf(c)), null),
      201,
    )

    return c.json(body, status)
  })

  app.get("/v1/products/:id", (c) => c.json(answer(found(c.req.param("id"))).body))

  app.patch("/v1/products/:id", async (c) => {
    const product = found(c.req.param("id"))
    const changes = productChanges(product, await bodyOf(c))

    return c.json(
      answer(
        bachs.products.change(product.id, { ...changes, updatedAt: iso(context.clock()) }) ??
          product,
      ).body,
    )
  })

  app.get("/v1/products", (c) => {
    const archived = c.req.query("include_archived") === "true"
    const products = bachs.products.where((product) => archived || !product.archivedAt).toReversed()

    return c.json(
      listPage(
        c,
        products.map((product) => productObject(product, organization())),
      ),
    )
  })

  for (const [action, archivedAt] of [
    ["archive", () => iso(context.clock())],
    ["unarchive", () => null],
  ] as const)
    app.post(`/v1/products/:id/${action}`, (c) => {
      const product = found(c.req.param("id"))

      return c.json(
        answer(
          bachs.products.change(product.id, {
            archivedAt: archivedAt(),
            updatedAt: iso(context.clock()),
          }) ?? product,
        ).body,
      )
    })
}
