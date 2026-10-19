import type { Context } from "../../http.ts"
import { requireIntegration } from "../auth.ts"
import type { PaystackRouteContext } from "../context.ts"
import type { Customer, Integration } from "../entities.ts"
import { bodyOf, fail, metadataOf, ok, pageOf, text } from "../helpers.ts"
import type { PaystackPayments } from "../payments.ts"
import { PROBLEMS } from "../problems.ts"
import type { PaystackStore } from "../store.ts"

/** The integration's customer by email or customer code. */
function findCustomer(
  paystack: PaystackStore,
  integration: Integration,
  key: string,
): Customer | undefined {
  const wanted = key.toLowerCase()

  return paystack.customers.where(
    (customer) =>
      customer.integration === integration.number &&
      (customer.customer_code.toLowerCase() === wanted || customer.email === wanted),
  )[0]
}

/** The details a create or update call sets, leaving out what it does not send. */
function detailsOf(fields: Record<string, unknown>): Partial<Customer> {
  const first = text(fields, "first_name")
  const last = text(fields, "last_name")
  const phone = text(fields, "phone")

  return {
    ...(first !== undefined && { first_name: first }),
    ...(last !== undefined && { last_name: last }),
    ...(phone !== undefined && { phone }),
    ...(fields["metadata"] !== undefined && { metadata: metadataOf(fields["metadata"]) }),
  }
}

async function create(
  c: Context,
  context: PaystackRouteContext,
  payments: PaystackPayments,
): Promise<Response> {
  const integration = requireIntegration(c, context.paystack)
  const fields = await bodyOf(c)
  const email = text(fields, "email")

  if (email === undefined || !email.includes("@"))
    return fail(c, 400, '"email" must be a valid email')

  const customer = payments.customerFor(integration, email)
  const updated = context.paystack.customers.change(customer.customer_code, {
    ...detailsOf(fields),
    updatedAt: context.clock().toISOString(),
  })

  return ok(c, "Customer created", updated)
}

/** Customers: create, list, fetch by email or code, and update. */
export function customerRoutes(context: PaystackRouteContext, payments: PaystackPayments): void {
  const { app, paystack } = context

  app.post("/customer", (c) => create(c, context, payments))

  app.get("/customer", (c) => {
    const integration = requireIntegration(c, paystack)
    const mine = paystack.customers.where((customer) => customer.integration === integration.number)
    const { data, meta } = pageOf(c, mine)

    return ok(c, "Customers retrieved", data, { meta })
  })

  /** Answers for the customer in the path, or 404 when the integration has no such customer. */
  const withCustomer =
    (answer: (c: Context, customer: Customer) => Response | Promise<Response>) => (c: Context) => {
      const customer = findCustomer(paystack, requireIntegration(c, paystack), c.req.param("key"))

      return customer === undefined
        ? fail(c, 404, "Customer not found", PROBLEMS.customerNotFound)
        : answer(c, customer)
    }

  app.get(
    "/customer/:key",
    withCustomer((c, customer) => {
      const authorizations = paystack.authorizations
        .all()
        .filter(
          (a) =>
            paystack.authorizations.extra(a.authorization_code)?.customer ===
            customer.customer_code,
        )

      return ok(c, "Customer retrieved", { ...customer, authorizations })
    }),
  )

  app.put(
    "/customer/:key",
    withCustomer(async (c, customer) => {
      const updated = paystack.customers.change(customer.customer_code, {
        ...detailsOf(await bodyOf(c)),
        updatedAt: context.clock().toISOString(),
      })

      return ok(c, "Customer updated", updated)
    }),
  )
}

/** A request naming a customer in its body: its integration, its fields and that customer. */
export async function customerInBody(c: Context, paystack: PaystackStore) {
  const integration = requireIntegration(c, paystack)
  const fields = await bodyOf(c)

  return {
    integration,
    fields,
    customer: findCustomer(paystack, integration, text(fields, "customer") ?? ""),
  }
}
