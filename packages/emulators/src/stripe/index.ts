import { defineEmulator, type EmulatorContext } from "../define.ts"
import { providerErrors } from "../errors.ts"
import type { Store } from "../store.ts"
import type { WebhookEndpoint } from "../webhooks.ts"
import { stripeApiKey } from "./auth.ts"
import type { StripeRouteContext } from "./context.ts"
import type { DisplayPreference, PaymentMethodConfiguration, Price } from "./entities.ts"
import { StripeEvents } from "./events.ts"
import { stripeExpand } from "./expand.ts"
import {
  customerObject,
  paymentMethodConfigurationObject,
  priceObject,
  productObject,
  webhookEndpointObject,
} from "./formatters.ts"
import { newId, stripeError, unix } from "./helpers.ts"
import { stripeIdempotency } from "./idempotency.ts"
import { stripeRequests } from "./requests.ts"
import { stripeResolver } from "./resolve.ts"
import { chargeRoutes } from "./routes/charges.ts"
import { checkoutSessionRoutes } from "./routes/checkout-sessions.ts"
import { customerSessionRoutes } from "./routes/customer-sessions.ts"
import { customerRoutes } from "./routes/customers.ts"
import { invoiceRoutes } from "./routes/invoices.ts"
import { paymentIntentRoutes } from "./routes/payment-intents.ts"
import { paymentMethodConfigurationRoutes } from "./routes/payment-method-configurations.ts"
import { paymentMethodRoutes } from "./routes/payment-methods.ts"
import { priceRoutes } from "./routes/prices.ts"
import { productRoutes } from "./routes/products.ts"
import { refundRoutes } from "./routes/refunds.ts"
import { webhookEndpointRoutes } from "./routes/webhook-endpoints.ts"
import { STRIPE_SANDBOX_DELIVERY, stripeWebhookHeaders } from "./signature.ts"
import { stripeStore } from "./store.ts"

export type * from "./entities.ts"
export { STRIPE_API_VERSION } from "./events.ts"
export { stripeOutboundFaults } from "./faults.ts"
export { stripeSignature } from "./signature.ts"

export type SeedCustomer = Partial<Record<"id" | "email" | "name" | "description", string>>

export type SeedProduct = { name: string; metadata?: Record<string, string> } & Partial<
  Record<"id" | "description", string>
>

/** A seeded price names its product by `product_name`, which must be seeded too. */
export type SeedPrice = Pick<Price, "currency"> & {
  product_name: string
  unit_amount: number
  id?: string
}

/** A webhook endpoint; without a `secret`, a random signing secret. */
export type SeedWebhookEndpoint = { url: string; events: string[]; secret?: string }

export type SeedPaymentMethodConfiguration = Pick<PaymentMethodConfiguration, "name"> &
  Partial<{ id: string; active: boolean; preferences: Record<string, DisplayPreference> }>

/** Data to load into a Stripe emulator, on top of its defaults. */
export type StripeSeedConfig = Partial<{
  readonly customers: readonly SeedCustomer[]
  readonly products: readonly SeedProduct[]
  readonly prices: readonly SeedPrice[]
  readonly webhookEndpoints: readonly SeedWebhookEndpoint[]
  readonly paymentMethodConfigurations: readonly SeedPaymentMethodConfiguration[]
}>

type StripeObjects = ReturnType<typeof stripeStore>

function seedCustomers(
  objects: StripeObjects,
  created: number,
  customers: readonly SeedCustomer[],
) {
  for (const customer of customers)
    objects.customers.add(
      customerObject({
        id: customer.id ?? newId("cus"),
        created,
        email: customer.email ?? null,
        name: customer.name ?? null,
        description: customer.description ?? null,
        phone: null,
        metadata: {},
      }),
      null,
    )
}

function seedProducts(objects: StripeObjects, created: number, products: readonly SeedProduct[]) {
  for (const product of products)
    objects.products.add(
      productObject({
        id: product.id ?? newId("prod"),
        created,
        name: product.name,
        description: product.description ?? null,
        active: true,
        metadata: product.metadata ?? {},
      }),
      null,
    )
}

function seedPrices(objects: StripeObjects, created: number, prices: readonly SeedPrice[]): void {
  for (const price of prices) {
    const product = objects.products.where((p) => p.name === price.product_name)[0]

    if (!product) throw new Error(`seedStripe: no product named "${price.product_name}"`)

    objects.prices.add(
      priceObject({
        id: price.id ?? newId("price"),
        created,
        product: product.id,
        currency: price.currency,
        unitAmount: price.unit_amount,
        active: true,
        nickname: null,
        lookupKey: null,
        taxBehavior: null,
        recurring: null,
        metadata: {},
      }),
      null,
    )
  }
}

function seedWebhookEndpoints(
  objects: StripeObjects,
  created: number,
  endpoints: readonly SeedWebhookEndpoint[],
): void {
  for (const endpoint of endpoints)
    objects.webhookEndpoints.add(
      webhookEndpointObject({
        id: newId("we"),
        created,
        url: endpoint.url,
        events: endpoint.events,
        description: null,
        metadata: {},
        apiVersion: null,
      }),
      { secret: endpoint.secret ?? `whsec_${newId("x", 32).slice(2)}` },
    )
}

function seedConfigurations(
  objects: StripeObjects,
  configurations: readonly SeedPaymentMethodConfiguration[],
): void {
  for (const configuration of configurations)
    objects.paymentMethodConfigurations.add(
      paymentMethodConfigurationObject({
        id: configuration.id ?? newId("pmc"),
        name: configuration.name,
        active: configuration.active ?? true,
        isDefault: false,
        preferences: configuration.preferences ?? {},
      }),
      null,
    )
}

/** Loads `config` into a Stripe emulator's store. No events are emitted for seeded data. */
export function seedStripe(store: Store, config: StripeSeedConfig): void {
  const objects = stripeStore(store)
  const created = unix(store.clock())

  seedCustomers(objects, created, config.customers ?? [])
  seedProducts(objects, created, config.products ?? [])
  seedPrices(objects, created, config.prices ?? [])
  seedWebhookEndpoints(objects, created, config.webhookEndpoints ?? [])
  seedConfigurations(objects, config.paymentMethodConfigurations ?? [])
}

/** What every fresh test account has: one customer and the default payment method configuration. */
function seedDefaults({ store }: EmulatorContext): void {
  seedStripe(store, { customers: [{ email: "test@example.com", name: "Test Customer" }] })
  stripeStore(store).paymentMethodConfigurations.add(
    paymentMethodConfigurationObject({
      id: newId("pmc"),
      name: "Default",
      active: true,
      isDefault: true,
      preferences: {},
    }),
    null,
  )
}

function routes(context: StripeRouteContext): void {
  for (const register of [
    customerRoutes,
    productRoutes,
    priceRoutes,
    paymentIntentRoutes,
    chargeRoutes,
    refundRoutes,
    paymentMethodRoutes,
    checkoutSessionRoutes,
    customerSessionRoutes,
    invoiceRoutes,
    paymentMethodConfigurationRoutes,
    webhookEndpointRoutes,
  ])
    register(context)

  context.events.routes(context.app)
}

/** The endpoints webhooks go to, with their secrets. */
function endpointsOf(store: Store): WebhookEndpoint[] {
  const { webhookEndpoints } = stripeStore(store)

  return webhookEndpoints.all().map((endpoint) => ({
    id: endpoint.id,
    url: endpoint.url,
    events: endpoint.enabled_events,
    secret: webhookEndpoints.extra(endpoint.id)?.secret ?? "",
    enabled: endpoint.status === "enabled",
  }))
}

/**
 * The Stripe API (`api.stripe.com`) and its hosted Checkout and invoice pages, in test mode.
 * Webhooks are signed like Stripe's and retried on a short schedule.
 */
export const stripe = defineEmulator({
  name: "stripe",
  setup(context) {
    const objects = stripeStore(context.store)
    const events = new StripeEvents(context.store, objects, context.outbox)
    const { app } = context

    app.onError(
      providerErrors((c, status, message) => stripeError(c, status, "api_error", message)),
    )
    app.use(stripeRequests())
    app.use(stripeApiKey())
    app.use(stripeIdempotency(context.store, context.clock))
    app.use(stripeExpand(stripeResolver(objects)))
    routes({ app, objects, events, baseUrl: context.baseUrl, clock: context.clock })
  },
  seed: seedDefaults,
  webhooks: ({ store }) => ({
    endpoints: () => endpointsOf(store),
    sign: ({ endpoint, body, timestamp }) => stripeWebhookHeaders(endpoint.secret, body, timestamp),
    policy: STRIPE_SANDBOX_DELIVERY,
  }),
})
