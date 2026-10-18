import type { StripeRouteContext } from "../context.ts"
import type { Customer } from "../entities.ts"
import { customerObject } from "../formatters.ts"
import {
  asRecord,
  clearableTexts,
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

/** `invoice_settings[default_payment_method]`, the card an invoice is charged to by default. */
function invoiceSettingsChange(
  current: Customer,
  params: Record<string, unknown>,
): Partial<Customer> {
  const method = text(asRecord(params.invoice_settings)?.default_payment_method)

  if (method === undefined) return {}

  return {
    invoice_settings: { ...current.invoice_settings, default_payment_method: method || null },
  }
}

/** Customers: create, retrieve, update, delete, list, and their saved payment methods. */
export function customerRoutes({ app, objects, events, clock }: StripeRouteContext): void {
  const { customers, deletedCustomers } = objects

  app.post("/v1/customers", async (c) => {
    const params = await readParams(c)
    const customer = customers.add(
      customerObject({
        id: newId("cus"),
        created: unix(clock()),
        email: textOrNull(params.email),
        name: textOrNull(params.name),
        description: textOrNull(params.description),
        phone: textOrNull(params.phone),
        metadata: metadataOf(params.metadata) ?? {},
      }),
      null,
    )

    events.emit("customer.created", customer)

    return c.json(customer)
  })

  app.get("/v1/customers/:id", (c) => {
    const id = c.req.param("id")
    const customer = customers.get(id) ?? deletedCustomers.get(id)

    return customer ? c.json(customer) : noSuch(c, "customer", id)
  })

  app.post("/v1/customers/:id", async (c) => {
    const id = c.req.param("id")
    const current = customers.get(id)

    if (!current) return noSuch(c, "customer", id)

    const params = await readParams(c)
    const updated = customers.change(id, {
      ...clearableTexts(params, ["email", "name", "description", "phone"] as const),
      metadata: mergeMetadata(current.metadata, metadataOf(params.metadata)),
      ...invoiceSettingsChange(current, params),
    })

    if (updated) events.emit("customer.updated", updated)

    return c.json(updated)
  })

  app.delete("/v1/customers/:id", (c) => {
    const id = c.req.param("id")
    const customer = customers.get(id)

    if (!customer) return noSuch(c, "customer", id)

    customers.remove(id)
    events.emit("customer.deleted", customer)

    return c.json(deletedCustomers.add({ id, object: "customer", deleted: true }, null))
  })

  app.get("/v1/customers", (c) => {
    const email = c.req.query("email")

    return listPage(
      c,
      customers.where((customer) => email === undefined || customer.email === email),
      "/v1/customers",
    )
  })

  app.get("/v1/customers/:customer/payment_methods", (c) => {
    const id = c.req.param("customer")

    if (!customers.get(id)) return noSuch(c, "customer", id)

    const type = c.req.query("type")

    return listPage(
      c,
      objects.paymentMethods.where(
        (method) => method.customer === id && (type === undefined || method.type === type),
      ),
      `/v1/customers/${id}/payment_methods`,
    )
  })
}
