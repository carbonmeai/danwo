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
}

/** A webhook endpoint keeps its signing secret, which the API shows only once. */
export interface EndpointSecret {
  readonly secret: string
}
