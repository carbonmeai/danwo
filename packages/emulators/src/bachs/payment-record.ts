import type { BachsContext } from "./context.ts"
import type { Customer, Payment } from "./entities.ts"
import { bachsId, iso } from "./helpers.ts"

/** What every new payment must say; everything else has a default. */
export type PaymentFields = Pick<
  Payment,
  "status" | "amount" | "currency" | "billingReason" | "method"
> &
  Partial<Payment>

/** A payment record with defaults for what `fields` leaves out, stamped with the current time. */
export function paymentRecord(context: BachsContext, fields: PaymentFields): Payment {
  const now = iso(context.clock())

  return {
    id: bachsId("ch", 12),
    substatus: null,
    checkoutId: null,
    subscriptionId: null,
    invoiceId: null,
    customerId: null,
    customerEmail: null,
    customerName: null,
    reference: null,
    cardLast4: null,
    deposit: null,
    refunded: 0,
    metadata: null,
    settlesAt: null,
    createdAt: now,
    updatedAt: now,
    completedAt: null,
    ...fields,
  }
}

/** The payer fields of a payment, from the customer when there is one. */
export function payerOf(customer: Customer | undefined): Partial<Payment> {
  return customer
    ? { customerId: customer.id, customerEmail: customer.email, customerName: customer.name }
    : {}
}

/** The card corridor a currency is charged on. */
export function cardMethod(currency: string): Payment["method"] {
  return currency === "NGN" ? "NGN_CARD" : "USD_CARD"
}
