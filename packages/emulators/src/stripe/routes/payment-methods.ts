import { addCard, defaultCard, paymentMethodFor, testCard } from "../cards.ts"
import type { StripeRouteContext } from "../context.ts"
import {
  asRecord,
  listPage,
  mergeMetadata,
  metadataOf,
  noSuch,
  readParams,
  stripeError,
  text,
} from "../helpers.ts"

/** Payment methods: create a card, retrieve, update, attach, detach and list by customer. */
export function paymentMethodRoutes({ app, objects, events, clock }: StripeRouteContext): void {
  const methods = objects.paymentMethods

  app.post("/v1/payment_methods", async (c) => {
    const params = await readParams(c)

    if ((text(params.type) ?? "card") !== "card")
      return stripeError(
        c,
        400,
        "invalid_request_error",
        "This emulator creates card payment methods only.",
        "parameter_invalid",
        "type",
      )

    const token = text(asRecord(params.card)?.token)
    const card = token ? testCard(token) : defaultCard()

    if (!card) return noSuch(c, "token", token ?? "", "card[token]")

    const method = addCard(objects, card, clock())

    return c.json(methods.change(method.id, { metadata: metadataOf(params.metadata) ?? {} }))
  })

  app.get("/v1/payment_methods/:id", (c) => {
    const id = c.req.param("id")
    const method = methods.get(id)

    return method ? c.json(method) : noSuch(c, "PaymentMethod", id)
  })

  app.post("/v1/payment_methods/:id", async (c) => {
    const id = c.req.param("id")
    const current = methods.get(id)

    if (!current) return noSuch(c, "PaymentMethod", id)

    const params = await readParams(c)
    const updated = methods.change(id, {
      metadata: mergeMetadata(current.metadata ?? {}, metadataOf(params.metadata)),
    })

    if (updated) events.emit("payment_method.updated", updated)

    return c.json(updated)
  })

  app.post("/v1/payment_methods/:id/attach", async (c) => {
    const id = c.req.param("id")
    const customer = text((await readParams(c)).customer)

    if (!customer || !objects.customers.get(customer))
      return noSuch(c, "customer", customer ?? "", "customer")

    // A test token such as `pm_card_visa` attaches a new payment method of that card, as Stripe does.
    const method = paymentMethodFor(objects, id, clock())

    if (!method) return noSuch(c, "PaymentMethod", id)

    const attached = methods.change(method.id, { customer })

    if (attached) events.emit("payment_method.attached", attached)

    return c.json(attached)
  })

  app.post("/v1/payment_methods/:id/detach", (c) => {
    const id = c.req.param("id")
    const method = methods.get(id)

    if (!method) return noSuch(c, "PaymentMethod", id)
    if (method.customer === null)
      return stripeError(
        c,
        400,
        "invalid_request_error",
        "The payment method you provided is not attached to a customer so detachment is impossible.",
      )

    const detached = methods.change(id, { customer: null })

    if (detached) events.emit("payment_method.detached", detached)

    return c.json(detached)
  })

  app.get("/v1/payment_methods", (c) => {
    const customer = c.req.query("customer")
    const type = c.req.query("type")

    return listPage(
      c,
      methods.where(
        (method) =>
          (customer === undefined || method.customer === customer) &&
          (type === undefined || method.type === type),
      ),
      "/v1/payment_methods",
    )
  })
}
