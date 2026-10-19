/**
 * A subscription-mode Checkout Session being paid: the payer becomes (or is) the customer, the
 * test card is saved as their default, and the subscription starts with its first invoice, free
 * when the session asked for a trial.
 */
import { CHECKOUT_TEST_CARD, paymentMethodFor } from "./cards.ts"
import type { StripeRouteContext } from "./context.ts"
import type { CheckoutSession, Customer, SessionPlan } from "./entities.ts"
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

/** Saves the Checkout test card to `customer` as their default for invoices. */
function saveCard(context: StripeRouteContext, customer: Customer): string {
  const card = paymentMethodFor(context.objects, CHECKOUT_TEST_CARD, context.clock())

  if (!card) throw new Error("the Checkout test card is missing")

  const attached = context.objects.paymentMethods.change(card.id, { customer: customer.id }) ?? card

  context.events.emit("payment_method.attached", attached)
  context.objects.customers.change(customer.id, {
    invoice_settings: { ...customer.invoice_settings, default_payment_method: card.id },
  })

  return card.id
}

/** Starts the subscription a paid session asked for; returns the session's new fields. */
export function subscribeSession(
  context: StripeRouteContext,
  session: CheckoutSession,
  plan: SessionPlan,
  email: string | null,
): Partial<CheckoutSession> {
  const customer = customerFor(context, session, email)
  const method = saveCard(context, customer)
  const trialDays = plan.subscription?.trialDays ?? null
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
