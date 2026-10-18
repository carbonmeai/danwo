import { isRecord } from "../../json.ts"
import type { BachsContext } from "../context.ts"
import { createCustomer, customerByEmail } from "../customers.ts"
import type { BillingAddress, Customer } from "../entities.ts"
import { customerObject } from "../formatters.ts"
import {
  BachsFailure,
  bachsId,
  bodyOf,
  type Changes,
  hex,
  invalid,
  iso,
  later,
  listPage,
  metadataOf,
  notFound,
  PORTAL_ORIGIN,
  text,
} from "../helpers.ts"

/** How long a portal session's URL works. */
const PORTAL_SESSION_MS = 60 * 60 * 1000

/** A billing address from a request: `line1` and a two-letter `country` are required. */
function addressOf(value: unknown): BillingAddress | null {
  if (value === null || value === undefined) return null
  if (!isRecord(value)) invalid("billing_address must be an object")

  const line1 = text(value, "line1")
  const country = text(value, "country")

  if (!line1 || !country || !/^[A-Z]{2}$/.test(country))
    invalid("billing_address needs line1 and an ISO 3166-1 alpha-2 country", {
      field: "billing_address",
      message: "Invalid address",
      type: "value_error",
    })

  const optional = (key: string) => text(value, key) ?? null

  return {
    line1,
    line2: optional("line2"),
    city: optional("city"),
    state: optional("state"),
    postal_code: optional("postal_code"),
    country,
  }
}

/** What a PATCH changes; `billing_address` replaces the whole address, `null` clears it. */
function customerChanges(body: Record<string, unknown>): Changes<Customer> {
  const changes: Changes<Customer> = {}
  const name = text(body, "name")
  const email = text(body, "email")
  const phone = text(body, "phone_number")

  if (name !== undefined) changes.name = name
  if (email !== undefined) changes.email = email
  if (phone !== undefined) changes.phoneNumber = phone
  if ("metadata" in body) changes.metadata = metadataOf(body["metadata"]) ?? {}
  if ("billing_address" in body) changes.billingAddress = addressOf(body["billing_address"])

  return changes
}

/** Whether a customer's email or name contains `search`, ignoring case. */
function matches(customer: Customer, search: string | undefined): boolean {
  if (!search) return true

  const wanted = search.toLowerCase()

  return [customer.email, customer.name ?? ""].some((value) => value.toLowerCase().includes(wanted))
}

/** Customers: create, retrieve, update, list or search, and customer portal sessions. */
export function customerRoutes(context: BachsContext): void {
  const { app, bachs } = context
  const found = (id: string) => bachs.customers.get(id) ?? notFound("Customer")

  app.post("/v1/customers", async (c) => {
    const body = await bodyOf(c)
    const email = text(body, "email")

    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))
      invalid("Missing required field(s): email", {
        field: "email",
        message: "A valid email is required",
        type: "value_error",
      })
    if (customerByEmail(context, email))
      throw new BachsFailure(409, "CONFLICT", "A customer with this email already exists")

    const customer = createCustomer(
      context,
      { email, name: text(body, "name") ?? null, phoneNumber: text(body, "phone_number") ?? null },
      {
        metadata: metadataOf(body["metadata"]) ?? {},
        billingAddress: addressOf(body["billing_address"]),
      },
    )

    return c.json(customerObject(customer), 201)
  })

  app.get("/v1/customers/:id", (c) => c.json(customerObject(found(c.req.param("id")))))

  app.patch("/v1/customers/:id", async (c) => {
    const customer = found(c.req.param("id"))
    const changed =
      bachs.customers.change(customer.id, {
        ...customerChanges(await bodyOf(c)),
        updatedAt: iso(context.clock()),
      }) ?? customer

    context.events.emit("customer.updated", customerObject(changed))

    return c.json(customerObject(changed))
  })

  app.get("/v1/customers", (c) => {
    const search = c.req.query("search")

    return c.json(
      listPage(
        c,
        bachs.customers
          .where((customer) => matches(customer, search))
          .toReversed()
          .map(customerObject),
      ),
    )
  })

  app.post("/v1/customers/:id/portal-sessions", (c) => {
    const customer = found(c.req.param("id"))
    const token = hex(16)
    const session = bachs.portalSessions.add(
      {
        id: bachsId("psn", 12),
        token,
        customerId: customer.id,
        expiresAt: iso(later(context.clock(), PORTAL_SESSION_MS)),
      },
      null,
    )

    return c.json({ id: session.id, url: `${PORTAL_ORIGIN}/s/${session.token}` }, 201)
  })
}
