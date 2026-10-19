/**
 * Billing a subscription's period: the invoice is drafted, finalized and collected from the
 * subscription's (or customer's) default card, through its lifecycle events. A card that is
 * declined or asks for 3D Secure leaves the invoice open with its PaymentIntent in that state.
 */
import { type BillingReason, subscriptionInvoiceObject } from "./billing-objects.ts"
import type { StripeRouteContext } from "./context.ts"
import type { Invoice, InvoiceIncludes, PaymentIntent, Subscription } from "./entities.ts"
import { idOf, newId, unix } from "./helpers.ts"
import { chargeIntent, createIntent } from "./payments.ts"

export type Billing = Pick<
  StripeRouteContext,
  "objects" | "events" | "baseUrl" | "clock" | "wakeAt"
>

/** How collecting an invoice went: paid, declined, held for 3D Secure, or nothing to charge. */
export type Collection = "paid" | "declined" | "authenticate" | "no_payment_method"

/** The card a subscription is charged to: its own default, else its customer's. */
export function defaultMethodOf(billing: Billing, subscription: Subscription): string | null {
  if (typeof subscription.default_payment_method === "string")
    return subscription.default_payment_method

  const customer =
    typeof subscription.customer === "string"
      ? billing.objects.customers.get(subscription.customer)
      : undefined
  const fallback = customer?.invoice_settings.default_payment_method

  return typeof fallback === "string" ? fallback : null
}

/** Each item's charge for a full period. */
export function periodAmounts(subscription: Subscription): number[] {
  return subscription.items.data.map((item) => (item.price.unit_amount ?? 0) * (item.quantity ?? 1))
}

/** A draft invoice for the subscription's current period, finalized right away. */
export function openInvoice(
  billing: Billing,
  subscription: Subscription,
  reason: BillingReason,
  amounts: readonly number[],
): Invoice {
  const { objects, events } = billing
  const id = newId("in")
  const now = unix(billing.clock())
  const customer =
    typeof subscription.customer === "string"
      ? objects.customers.get(subscription.customer)
      : undefined
  const draft = objects.invoices.add(
    subscriptionInvoiceObject({
      id,
      number: `DANWO-${String(objects.invoices.all().length + 1).padStart(4, "0")}`,
      created: now,
      subscription,
      customerEmail: customer?.email ?? null,
      reason,
      amounts,
      productNames: subscription.items.data.map(
        (item) => objects.products.get(idOf(item.price.product))?.name ?? "",
      ),
      hostedUrl: `${billing.baseUrl}/invoices/${id}`,
    }),
    null,
  )

  events.emit("invoice.created", draft)

  const open =
    objects.invoices.change(id, {
      status: "open",
      effective_at: now,
      status_transitions: { ...draft.status_transitions, finalized_at: now },
    }) ?? draft

  events.emit("invoice.finalized", open)

  return open
}

/** Keeps what an invoice shows when expanded: its payments and its intent's client secret. */
function include(billing: Billing, invoice: Invoice, intent: PaymentIntent | null): void {
  const includes: InvoiceIncludes = {
    id: invoice.id,
    payments: {
      object: "list",
      data: intent ? [invoicePayment(billing, invoice, intent)] : [],
      has_more: false,
      url: "/v1/invoices/payments",
    },
    confirmation_secret: intent?.client_secret
      ? { client_secret: intent.client_secret, type: "payment_intent" }
      : null,
  }

  billing.objects.invoiceIncludes.remove(invoice.id)
  billing.objects.invoiceIncludes.add(includes, null)
}

/** The invoice's payment by `intent`, as `payments` lists it. */
function invoicePayment(billing: Billing, invoice: Invoice, intent: PaymentIntent) {
  const paid = intent.status === "succeeded"
  const now = unix(billing.clock())

  return {
    id: newId("inpay"),
    object: "invoice_payment" as const,
    amount_paid: paid ? intent.amount : null,
    amount_requested: intent.amount,
    created: now,
    currency: intent.currency,
    invoice: invoice.id,
    is_default: true,
    livemode: false,
    payment: { payment_intent: intent.id, type: "payment_intent" as const },
    status: paid ? ("paid" as const) : ("open" as const),
    status_transitions: { canceled_at: null, paid_at: paid ? now : null },
  }
}

/** Marks an open invoice paid and sends `invoice.paid` and `invoice.payment_succeeded`. */
export function markPaid(
  billing: Billing,
  invoice: Invoice,
  intent: PaymentIntent | null,
): Invoice {
  const now = unix(billing.clock())
  const paid =
    billing.objects.invoices.change(invoice.id, {
      status: "paid",
      amount_paid: invoice.amount_due,
      amount_remaining: 0,
      attempted: intent !== null || invoice.attempted,
      attempt_count: invoice.attempt_count + (intent ? 1 : 0),
      ending_balance: 0,
      status_transitions: { ...invoice.status_transitions, paid_at: now },
    }) ?? invoice

  include(billing, paid, intent)
  billing.events.emit("invoice.paid", paid)
  billing.events.emit("invoice.payment_succeeded", paid)

  return paid
}

/** Records a failed attempt on an invoice and sends its failure events. */
function markFailed(billing: Billing, invoice: Invoice, intent: PaymentIntent): Invoice {
  const failed =
    billing.objects.invoices.change(invoice.id, {
      attempted: true,
      attempt_count: invoice.attempt_count + 1,
    }) ?? invoice

  include(billing, failed, intent)
  if (intent.status === "requires_action")
    billing.events.emit("invoice.payment_action_required", failed)
  billing.events.emit("invoice.payment_failed", failed)

  return failed
}

/** The saved card `method` names, if any. */
function cardOf(billing: Billing, method: string | null) {
  return method === null ? undefined : billing.objects.paymentMethods.get(method)
}

/** The PaymentIntent that collects `invoice`, to be charged to `card` (or confirmed later). */
function intentFor(billing: Billing, invoice: Invoice, card: string | null, description: string) {
  return createIntent(billing, {
    amount: invoice.amount_due,
    currency: invoice.currency,
    customer: idOf(invoice.customer) || null,
    description,
    metadata: {},
    paymentMethod: card,
    setupFutureUsage: null,
    receiptEmail: null,
  })
}

/**
 * Collects `invoice`: zero-amount invoices are paid at once; otherwise the card is charged off
 * session. `confirmLater` leaves a PaymentIntent for the app's page to confirm (the
 * `default_incomplete` payment behavior) instead of charging.
 */
export function collect(
  billing: Billing,
  invoice: Invoice,
  method: string | null,
  options: { readonly confirmLater?: boolean; readonly description: string },
): { readonly invoice: Invoice; readonly outcome: Collection } {
  if (invoice.amount_due === 0)
    return { invoice: markPaid(billing, invoice, null), outcome: "paid" }

  const card = options.confirmLater ? undefined : cardOf(billing, method)
  const intent = intentFor(billing, invoice, card?.id ?? null, options.description)

  if (!card) {
    include(billing, invoice, intent)

    return { invoice, outcome: "no_payment_method" }
  }

  const charged = chargeIntent(billing, intent, card)

  if (charged.status === "succeeded")
    return { invoice: markPaid(billing, invoice, charged), outcome: "paid" }

  return {
    invoice: markFailed(billing, invoice, charged),
    outcome: charged.status === "requires_action" ? "authenticate" : "declined",
  }
}

/** The open invoice whose PaymentIntent is `intent`, if any. */
export function invoiceOfIntent(billing: Billing, intent: PaymentIntent): Invoice | undefined {
  const owner = billing.objects.invoiceIncludes.where((found) =>
    found.payments.data.some((payment) => payment.payment.payment_intent === intent.id),
  )[0]

  return owner ? billing.objects.invoices.get(owner.id) : undefined
}
