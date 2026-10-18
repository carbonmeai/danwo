import { objectTable, type ObjectTable } from "../objects.ts"
import type { Store } from "../store.ts"
import type {
  Charge,
  CheckoutSession,
  Customer,
  DeletedCustomer,
  EndpointSecret,
  Invoice,
  PaymentIntent,
  PaymentMethod,
  PaymentMethodConfiguration,
  Price,
  Product,
  Refund,
  SessionPlan,
  StripeWebhookEndpoint,
} from "./entities.ts"

type Kind = <T extends { id: string }, X = null>(name: string) => ObjectTable<T, X>

/** What is sold: products and their prices, and who buys them. */
function catalog(kind: Kind) {
  return {
    customers: kind<Customer>("customers"),
    /** Customers deleted through the API, which still read back as `deleted: true`. */
    deletedCustomers: kind<DeletedCustomer>("deleted_customers"),
    products: kind<Product>("products"),
    prices: kind<Price>("prices"),
  }
}

/** Money moving: intents, charges, cards, Checkout and invoices. */
function payments(kind: Kind) {
  return {
    paymentIntents: kind<PaymentIntent>("payment_intents"),
    charges: kind<Charge>("charges"),
    refunds: kind<Refund>("refunds"),
    paymentMethods: kind<PaymentMethod>("payment_methods"),
    checkoutSessions: kind<CheckoutSession, SessionPlan>("checkout_sessions"),
    invoices: kind<Invoice>("invoices"),
  }
}

/** Account settings: which methods Checkout shows, and where webhooks go. */
function settings(kind: Kind) {
  return {
    paymentMethodConfigurations: kind<PaymentMethodConfiguration>("payment_method_configurations"),
    webhookEndpoints: kind<StripeWebhookEndpoint, EndpointSecret>("webhook_endpoints"),
  }
}

/** The Stripe objects held in an emulator's store, one collection per kind. */
export function stripeStore(store: Store) {
  const kind: Kind = (name) => objectTable(store, `stripe.${name}`)

  return { ...catalog(kind), ...payments(kind), ...settings(kind) }
}

/** Every kind of object the Stripe emulator keeps. */
export type StripeStore = ReturnType<typeof stripeStore>
