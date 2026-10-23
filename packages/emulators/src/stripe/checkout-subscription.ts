/**
 * A subscription-mode Checkout Session being paid: the payer becomes (or is) the customer, the
 * card they typed is saved as their default, and the subscription starts with its first invoice,
 * free when the session asked for a trial. A card that declines leaves the session open.
 */
import { cardOutcome, paymentMethodFor } from "./cards.ts"
import type { StripeRouteContext } from "./context.ts"
import type { CheckoutSession, Customer, PaymentMethod, SessionPlan } from "./entities.ts"
import { customerObject } from "./formatters.ts"
import { asRecord, integer, metadataOf, newId, unix } from "./helpers.ts"
import { subscribe } from "./subscribing.ts"

/** The `subscription_data` a subscription-mode session keeps for when it is paid. */
export function subscriptionPlan(
  params: Record<string, unknown>,
): NonNullable<SessionPlan["subscription"]> {
  const data = asRecord(params.subscription_data)
  const days = integer(data?.trial_period_days)

  return {
    trialDays: days !== undefined && days > 0 ? days : null,
    metadata: metadataOf(data?.metadata) ?? {},
  }
}

/** The session's customer, or a new one for the payer's email. */
function customerFor(
  context: StripeRouteContext,
  session: CheckoutSession,
  email: string | null,
): Customer {
  const existing =
    typeof session.customer === "string"
      ? context.objects.customers.get(session.customer)
      : undefined

  if (existing) return existing

  const created = context.objects.customers.add(
    customerObject({
      id: newId("cus"),
      created: unix(context.clock()),
      email,
      name: null,
      description: null,
      phone: null,
      metadata: {},
    }),
    null,
  )

  context.events.emit("customer.created", created)

  return created
}

/** Saves `card` to `customer` as their default for invoices. */
function saveCard(context: StripeRouteContext, customer: Customer, card: PaymentMethod): string {
  const attached = context.objects.paymentMethods.change(card.id, { customer: customer.id }) ?? card

  context.events.emit("payment_method.attached", attached)
  context.objects.customers.change(customer.id, {
    invoice_settings: { ...customer.invoice_settings, default_payment_method: card.id },
  })

  return card.id
}

/**
 * The payment method for the test card `reference`, or undefined when it declines: when the first
 * invoice charges it, or, with a trial, when it is saved.
 */
function acceptedCard(
  context: StripeRouteContext,
  reference: string,
  trial: boolean,
): PaymentMethod | undefined {
  const card = paymentMethodFor(context.objects, reference, context.clock())

  if (!card) throw new Error(`the Checkout test card ${reference} is missing`)

  return cardOutcome(card, trial ? "setup" : "charge") === "declined" ? undefined : card
}

/**
 * Starts the subscription a paid session asked for, paid with the test card `payment.card`
 * (`pm_card_visa`); returns the session's new fields. A card that declines starts nothing, and
 * the payer is told why.
 */
export function subscribeSession(
  context: StripeRouteContext,
  session: CheckoutSession,
  plan: SessionPlan,
  payment: { readonly email: string | null; readonly card: string },
): Partial<CheckoutSession> | { readonly declined: string } {
  const trialDays = plan.subscription?.trialDays ?? null
  const card = acceptedCard(context, payment.card, trialDays !== null)

  if (!card) return { declined: "Your card was declined." }

  const customer = customerFor(context, session, payment.email)
  const method = saveCard(context, customer, card)
  const started = subscribe(context, {
    customer,
    items: plan.lines.flatMap((line) => {
      const price = context.objects.prices.get(line.price)

      return price ? [{ price, quantity: line.quantity, metadata: {} }] : []
    }),
    trialEnd: trialDays === null ? null : unix(context.clock()) + trialDays * 86_400,
    defaultPaymentMethod: method,
    behavior: "allow_incomplete",
    missingPaymentMethod: "create_invoice",
    saveDefaultPaymentMethod: "off",
    description: null,
    metadata: plan.subscription?.metadata ?? {},
  })

  if ("code" in started)
    throw new Error(`Checkout could not start the subscription: ${started.message}`)

  return {
    customer: customer.id,
    subscription: started.id,
    invoice: typeof started.latest_invoice === "string" ? started.latest_invoice : null,
    payment_status: started.status === "trialing" ? "no_payment_required" : "paid",
  }
}
