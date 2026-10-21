import { defineEmulator, type EmulatorContext } from "../define.ts"
import { providerErrors } from "../errors.ts"
import type { Store } from "../store.ts"
import { signedOnWallClock, type WebhookEndpoint } from "../webhooks.ts"
import { stripeApiKey } from "./auth.ts"
import type { StripeRouteContext } from "./context.ts"
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
import { stripeIncludes, stripeResolver } from "./resolve.ts"
import { billingPortalRoutes } from "./routes/billing-portal.ts"
import { chargeRoutes } from "./routes/charges.ts"
import { checkoutSessionRoutes } from "./routes/checkout-sessions.ts"
import { customerSessionRoutes } from "./routes/customer-sessions.ts"
import { customerRoutes } from "./routes/customers.ts"
import { invoiceItemRoutes } from "./routes/invoice-items.ts"
import { invoiceRoutes } from "./routes/invoices.ts"
import { paymentIntentRoutes } from "./routes/payment-intents.ts"
import { paymentMethodConfigurationRoutes } from "./routes/payment-method-configurations.ts"
import { paymentMethodRoutes } from "./routes/payment-methods.ts"
import { priceRoutes } from "./routes/prices.ts"
import { productRoutes } from "./routes/products.ts"
import { refundRoutes } from "./routes/refunds.ts"
import { setupIntentRoutes } from "./routes/setup-intents.ts"
import { subscriptionRoutes } from "./routes/subscriptions.ts"
import { webhookEndpointRoutes } from "./routes/webhook-endpoints.ts"
import { STRIPE_SANDBOX_DELIVERY, stripeWebhookHeaders } from "./signature.ts"
import { stripeStore } from "./store.ts"
import { STRIPE_JS } from "./stripe-js.ts"
import { runDue, scheduleNext } from "./subscribing.ts"

export { STRIPE_BEHAVIOURS, stripeOutboundFaults } from "./faults.ts"
export { stripeSignature } from "./signature.ts"

export type SeedCustomer = Partial<Record<"id" | "email" | "name" | "description", string>>

export type SeedProduct = { name: string; metadata?: Record<string, string> } & Partial<
  Record<"id" | "description", string>
>

/**
 * A seeded price names its product by `product_name`, which must be seeded too. `recurring`
 * makes it a subscription price; `lookup_key` lets an app find it by a name of its own, as a
 * `plans` table that stores lookup keys does.
 */
export type SeedPrice = {
  currency: string
  product_name: string
  unit_amount: number
  id?: string
  lookup_key?: string
  nickname?: string
  recurring?: { interval: "day" | "week" | "month" | "year"; interval_count?: number }
}

/** A webhook endpoint; without a `secret`, a random signing secret. */
export type SeedWebhookEndpoint = { url: string; events: string[]; secret?: string }

/** A payment method configuration; `preferences` turns each method `on`, `off` or `none` in Checkout. */
export type SeedPaymentMethodConfiguration = { name: string } & Partial<{
  id: string
  active: boolean
  preferences: Record<string, "on" | "off" | "none">
}>

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
        nickname: price.nickname ?? null,
        lookupKey: price.lookup_key ?? null,
        taxBehavior: "unspecified",
        recurring: price.recurring
          ? {
              interval: price.recurring.interval,
              interval_count: price.recurring.interval_count ?? 1,
            }
          : null,
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

/** The headers the API answers a page with, so Stripe.js can call it from the app's origin. */
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, content-type, stripe-version, idempotency-key",
  "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
}

/** Stripe.js, at `js.stripe.com/v3` and at the versioned `/<version>/stripe.js` paths. */
function stripeJsRoutes({ app }: StripeRouteContext): void {
  const headers = {
    "content-type": "application/javascript; charset=utf-8",
    "cache-control": "no-store",
  }

  for (const path of ["/v3", "/v3/", "/:version/stripe.js"])
    app.get(path, (c) => c.body(STRIPE_JS, 200, headers))
}

function routes(context: StripeRouteContext): void {
  for (const register of [
    stripeJsRoutes,
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
    invoiceItemRoutes,
    subscriptionRoutes,
    setupIntentRoutes,
    billingPortalRoutes,
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
/** Each emulator's billing, for `restored` to schedule its subscriptions' work again. */
const billings = new WeakMap<object, Parameters<typeof runDue>[0]>()

export const stripe = defineEmulator({
  name: "stripe",
  setup(context) {
    const objects = stripeStore(context.store)
    const events = new StripeEvents(context.store, objects, context.outbox)
    const { app } = context

    app.onError(
      providerErrors((c, status, message) => stripeError(c, status, "api_error", message)),
    )
    /* Stripe.js calls the API from the app's page, across origins, as the real API allows. */
    app.use((c, next) => {
      if (!c.req.path.startsWith("/v1/")) return next()
      if (c.req.method === "OPTIONS") return c.body(null, 204, CORS)

      for (const [name, value] of Object.entries(CORS)) c.header(name, value)

      return next()
    })
    app.use(stripeRequests())
    app.use(stripeApiKey())
    app.use(stripeIdempotency(context.store, context.clock))
    app.use(stripeExpand(stripeResolver(objects), stripeIncludes(objects)))

    const wakeAt = (at: Date) => {
      context.timer.setTimeout(
        () => runDue(billing),
        Math.max(0, at.getTime() - context.clock().getTime()),
        { background: true },
      )
    }

    const billing = { app, objects, events, baseUrl: context.baseUrl, clock: context.clock, wakeAt }

    routes(billing)
    billings.set(context, billing)
  },
  restored(context) {
    const billing = billings.get(context)

    if (billing === undefined) return
    for (const subscription of billing.objects.subscriptions.all())
      if (["active", "trialing", "past_due", "incomplete"].includes(subscription.status))
        scheduleNext(billing, subscription)
  },
  seed: seedDefaults,
  webhooks: ({ store, clock, wallClock }) => ({
    endpoints: () => endpointsOf(store),
    sign: signedOnWallClock(clock, wallClock, ({ endpoint, body, timestamp }) =>
      stripeWebhookHeaders(endpoint.secret, body, timestamp),
    ),
    policy: STRIPE_SANDBOX_DELIVERY,
  }),
})
