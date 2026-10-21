import { objectTable, type ObjectTable } from "../objects.ts"
import type { Store } from "../store.ts"
import type {
  BillingPortalSession,
  Charge,
  CheckoutSession,
  Customer,
  DeletedCustomer,
  EndpointSecret,
  Invoice,
  InvoiceItem,
  InvoiceIncludes,
  PaymentIntent,
  PaymentMethod,
  PaymentMethodConfiguration,
  Price,
  Product,
  Refund,
  SessionPlan,
  SetupIntent,
  StripeWebhookEndpoint,
  Subscription,
  SubscriptionState,
} from "./entities.ts"

type Kind = <T extends { id: string }, X = null>(name: string) => ObjectTable<T, X>

/** The Stripe objects held in an emulator's store, one collection per kind. */
export interface StripeStore {
  customers: ObjectTable<Customer>
  /** Customers deleted through the API, which still read back as `deleted: true`. */
  deletedCustomers: ObjectTable<DeletedCustomer>
  products: ObjectTable<Product>
  prices: ObjectTable<Price>
  paymentIntents: ObjectTable<PaymentIntent>
  charges: ObjectTable<Charge>
  refunds: ObjectTable<Refund>
  paymentMethods: ObjectTable<PaymentMethod>
  checkoutSessions: ObjectTable<CheckoutSession, SessionPlan>
  invoices: ObjectTable<Invoice>
  /** One-off charges waiting for the customer's next invoice. */
  invoiceItems: ObjectTable<InvoiceItem>
  /** What each invoice shows when expanded (`payments`, `confirmation_secret`), by invoice id. */
  invoiceIncludes: ObjectTable<InvoiceIncludes>
  subscriptions: ObjectTable<Subscription, SubscriptionState>
  /** The setups that save cards for subscriptions. */
  setupIntents: ObjectTable<SetupIntent>
  portalSessions: ObjectTable<BillingPortalSession>
  /** Which methods Checkout shows. */
  paymentMethodConfigurations: ObjectTable<PaymentMethodConfiguration>
  webhookEndpoints: ObjectTable<StripeWebhookEndpoint, EndpointSecret>
}

/** The Stripe objects held in an emulator's store, one collection per kind. */
export function stripeStore(store: Store): StripeStore {
  const kind: Kind = (name) => objectTable(store, `stripe.${name}`)

  return {
    customers: kind("customers"),
    deletedCustomers: kind("deleted_customers"),
    products: kind("products"),
    prices: kind("prices"),
    paymentIntents: kind("payment_intents"),
    charges: kind("charges"),
    refunds: kind("refunds"),
    paymentMethods: kind("payment_methods"),
    checkoutSessions: kind("checkout_sessions"),
    invoices: kind("invoices"),
    invoiceItems: kind("invoice_items"),
    invoiceIncludes: kind("invoice_includes"),
    subscriptions: kind("subscriptions"),
    setupIntents: kind("setup_intents"),
    portalSessions: kind("billing_portal_sessions"),
    paymentMethodConfigurations: kind("payment_method_configurations"),
    webhookEndpoints: kind("webhook_endpoints"),
  }
}
