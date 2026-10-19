import type Stripe from "stripe"

/** An SDK type as it travels over the wire: decimal amounts are strings. */
export type Json<T> = T extends Stripe.Decimal
  ? string
  : T extends string | number | boolean | null | undefined
    ? T
    : T extends readonly (infer U)[]
      ? Json<U>[]
      : T extends object
        ? { -readonly [K in keyof T]: Json<T[K]> }
        : T

export type Customer = Json<Stripe.Customer>
export type Product = Json<Stripe.Product>
export type Price = Json<Stripe.Price>
export type PaymentIntent = Json<Stripe.PaymentIntent>
export type Charge = Json<Stripe.Charge>
export type Refund = Json<Stripe.Refund>
export type DeletedCustomer = Json<Stripe.DeletedCustomer>
export type PaymentMethod = Json<Stripe.PaymentMethod>
export type CheckoutSession = Json<Stripe.Checkout.Session>
export type Invoice = Json<Stripe.Invoice>
export type PaymentMethodConfiguration = Json<Stripe.PaymentMethodConfiguration>
export type StripeWebhookEndpoint = Json<Stripe.WebhookEndpoint>
export type CardDetails = Json<Stripe.PaymentMethod.Card>
export type SetupIntent = Json<Stripe.SetupIntent>
export type SubscriptionItem = Json<Stripe.SubscriptionItem>
export type Plan = Json<Stripe.Plan>
export type BillingPortalSession = Json<Stripe.BillingPortal.Session>

/**
 * A subscription as the API answers it: the SDK's type plus the legacy single-plan fields Stripe
 * still sends (`plan`, `quantity`, from the first item).
 */
export type Subscription = Json<Stripe.Subscription> & {
  plan: Plan | null
  quantity: number | null
}

/** What the emulator keeps about a subscription beyond what the API shows. */
export interface SubscriptionState {
  /** Whether `customer.subscription.trial_will_end` went out for the current trial. */
  trialNoticeSent: boolean
}

/**
 * What an invoice shows only when a request expands it: its payments, and the client secret of
 * the PaymentIntent that collects it.
 */
export interface InvoiceIncludes {
  readonly id: string
  payments: Json<Stripe.ApiList<Stripe.InvoicePayment>>
  confirmation_secret: { client_secret: string; type: "payment_intent" } | null
}

/** How a payment method shows up in Checkout under a payment method configuration. */
export type DisplayPreference = "on" | "off" | "none"

/** One line of a Checkout Session, resolved to a price when the session is created. */
export interface SessionLine {
  readonly price: string
  readonly quantity: number
  readonly description: string
  readonly unitAmount: number
  readonly currency: string
}

/** What a Checkout Session passes on to the PaymentIntent and invoice it creates on payment. */
export interface SessionPlan {
  readonly lines: readonly SessionLine[]
  readonly intent: {
    readonly description: string | null
    readonly metadata: Record<string, string>
    readonly setupFutureUsage: "off_session" | "on_session" | null
  }
  readonly invoice: {
    readonly description: string | null
    readonly metadata: Record<string, string>
  } | null
  /** A subscription-mode session's `subscription_data`. */
  readonly subscription?: {
    readonly trialDays: number | null
    readonly metadata: Record<string, string>
  }
}

/** A webhook endpoint keeps its signing secret, which the API shows only once. */
export interface EndpointSecret {
  readonly secret: string
}
