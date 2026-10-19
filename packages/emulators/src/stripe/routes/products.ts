import type { StripeRouteContext } from "../context.ts"
import { productObject } from "../formatters.ts"
import {
  badParam,
  flag,
  listPage,
  mergeMetadata,
  metadataOf,
  newId,
  noSuch,
  readParams,
  stripeError,
  text,
  unix,
} from "../helpers.ts"

/** Products: create (optionally with your own id), retrieve, update and list. */
export function productRoutes({ app, objects, events, clock }: StripeRouteContext): void {
  const { products } = objects

  app.post("/v1/products", async (c) => {
    const params = await readParams(c)
    const name = text(params.name)

    if (!name) return badParam(c, "name")

    const id = text(params.id) ?? newId("prod")

    if (products.get(id))
      return stripeError(
        c,
        400,
        "invalid_request_error",
        `Product already exists.`,
        "resource_already_exists",
        "id",
      )

    const product = products.add(
      productObject({
        id,
        created: unix(clock()),
        name,
        description: text(params.description) ?? null,
        active: flag(params.active) ?? true,
        metadata: metadataOf(params.metadata) ?? {},
        taxCode: text(params.tax_code) ?? null,
      }),
      null,
    )

    events.emit("product.created", product)

    return c.json(product)
  })

  app.get("/v1/products/:id", (c) => {
    const id = c.req.param("id")
    const product = products.get(id)

    return product ? c.json(product) : noSuch(c, "product", id)
  })

  app.post("/v1/products/:id", async (c) => {
    const id = c.req.param("id")
    const current = products.get(id)

    if (!current) return noSuch(c, "product", id)

    const params = await readParams(c)
    const active = flag(params.active)
    const name = text(params.name)
    const updated = products.change(id, {
      ...(name && { name }),
      ...(params.description !== undefined && { description: text(params.description) || null }),
      ...(active !== undefined && { active }),
      metadata: mergeMetadata(current.metadata, metadataOf(params.metadata)),
      updated: unix(clock()),
    })

    if (updated) events.emit("product.updated", updated)

    return c.json(updated)
  })

  app.get("/v1/products", (c) => {
    const active = flag(c.req.query("active"))

    return listPage(
      c,
      products.where((product) => active === undefined || product.active === active),
      "/v1/products",
    )
  })
}
