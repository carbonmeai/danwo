import type { BachsContext } from "./context.ts"
import type { Customer } from "./entities.ts"
import { customerObject } from "./formatters.ts"
import { bachsId, iso } from "./helpers.ts"

/** Who a customer is, as a checkout or the API names them. */
export interface Identity {
  readonly email: string
  readonly name: string | null
  readonly phoneNumber?: string | null
}

/** The customer with `email`, if the account holds one. */
export function customerByEmail(context: BachsContext, email: string): Customer | undefined {
  const wanted = email.toLowerCase()

  return context.bachs.customers.where((customer) => customer.email.toLowerCase() === wanted)[0]
}

/** Creates a customer and announces it with `customer.created`. */
export function createCustomer(
  context: BachsContext,
  identity: Identity,
  extra: Partial<Pick<Customer, "metadata" | "billingAddress">> = {},
): Customer {
  const now = iso(context.clock())
  const customer = context.bachs.customers.add(
    {
      id: bachsId("cust", 12),
      email: identity.email,
      name: identity.name,
      phoneNumber: identity.phoneNumber ?? null,
      metadata: extra.metadata ?? {},
      billingAddress: extra.billingAddress ?? null,
      credit: {},
      createdAt: now,
      updatedAt: now,
    },
    null,
  )

  context.events.emit("customer.created", customerObject(customer))

  return customer
}

/** The customer with `identity`'s email, created when the account has none: the same email is never duplicated. */
export function matchOrCreateCustomer(context: BachsContext, identity: Identity): Customer {
  return customerByEmail(context, identity.email) ?? createCustomer(context, identity)
}
