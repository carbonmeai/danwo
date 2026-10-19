/**
 * Stripe's billing scenarios: a SetupIntent saving a card, subscriptions (a trial, an active one,
 * cancelling at the period end and at once) and the invoices a subscription bills. Every object
 * made is cleaned up: subscriptions canceled, prices and products archived, the customer deleted.
 */
import type { Answer, Scenario, ScenarioContext } from "../scenario.ts"
import { asJsonObject, type Json } from "../shape.ts"

/** How the Stripe suite calls the API. */
export interface StripeCaller {
  call(
    context: ScenarioContext,
    method: string,
    path: string,
    values?: Readonly<Record<string, unknown>>,
  ): Request
  field(answer: Answer, name: string): string
  /** Writes down an object the run made, undone by sending `method path` with `values`. */
  made(
    context: ScenarioContext,
    kind: string,
    id: string,
    method: string,
    path: string,
    values?: Readonly<Record<string, unknown>>,
  ): void
}

/** A nested string field of an answer, such as `latest_invoice.id`. */
function nested(answer: Answer, path: string): string {
  let value: Json | undefined = answer.body

  for (const key of path.split(".")) value = asJsonObject(value)?.[key]

  if (typeof value !== "string") throw new Error(`expected the answer to have a string ${path}`)

  return value
}

/** A customer with a saved Visa test card as its default for invoices. */
async function customerWithCard(context: ScenarioContext, api: StripeCaller): Promise<string> {
  const customer = await context.step(
    "create customer",
    api.call(context, "POST", "/v1/customers", { email: `${context.tag}@example.com` }),
  )
  const id = api.field(customer, "id")

  api.made(context, "customer", id, "DELETE", `/v1/customers/${id}`)

  const setup = await context.step(
    "create setup intent",
    api.call(context, "POST", "/v1/setup_intents", {
      customer: id,
      automatic_payment_methods: { enabled: true, allow_redirects: "never" },
    }),
    { literals: ["status"], doc: { operation: "post /v1/setup_intents", status: 200 } },
  )
  const setupId = api.field(setup, "id")

  api.made(context, "setup intent", setupId, "POST", `/v1/setup_intents/${setupId}/cancel`)

  const confirmed = await context.step(
    "confirm setup intent with a test card",
    api.call(context, "POST", `/v1/setup_intents/${setupId}/confirm`, {
      payment_method: "pm_card_visa",
    }),
    {
      literals: ["status"],
      doc: {
        operation: "post /v1/setup_intents/{intent}/confirm",
        status: 200,
        literals: { status: "succeeded" },
      },
    },
  )

  await context.step(
    "make the card the customer's default",
    api.call(context, "POST", `/v1/customers/${id}`, {
      invoice_settings: { default_payment_method: api.field(confirmed, "payment_method") },
    }),
  )

  return id
}

/** A monthly price on a new product, both archived afterwards. */
async function monthlyPrice(context: ScenarioContext, api: StripeCaller): Promise<string> {
  const product = await context.step(
    "create product",
    api.call(context, "POST", "/v1/products", {
      name: `${context.tag} plan`,
      tax_code: "txcd_10103001",
    }),
  )
  const productId = api.field(product, "id")

  api.made(context, "product", productId, "POST", `/v1/products/${productId}`, { active: false })

  const price = await context.step(
    "create monthly price",
    api.call(context, "POST", "/v1/prices", {
      product: productId,
      unit_amount: 2000,
      currency: "usd",
      recurring: { interval: "month" },
    }),
  )
  const id = api.field(price, "id")

  api.made(context, "price", id, "POST", `/v1/prices/${id}`, { active: false })

  return id
}

/** Cancels a subscription when the scenario ends. */
function cancelLater(context: ScenarioContext, api: StripeCaller, id: string): void {
  api.made(context, "subscription", id, "DELETE", `/v1/subscriptions/${id}`)
}

/** The billing scenarios, calling the API the way the rest of the Stripe suite does. */
export function stripeBillingScenarios(api: StripeCaller): Scenario[] {
  const setupIntents: Scenario = {
    name: "setup intent: create and confirm with a test card",
    async run(context) {
      await customerWithCard(context, api)
    },
  }

  const subscriptions: Scenario = {
    name: "subscriptions: trial, active, cancel at period end, cancel",
    documentedFacts: [{ name: "subscriptions listed for the customer", value: 2 }],
    async run(context) {
      const customer = await customerWithCard(context, api)
      const price = await monthlyPrice(context, api)
      const trial = await context.step(
        "create trial subscription",
        api.call(context, "POST", "/v1/subscriptions", {
          customer,
          items: [{ price }],
          trial_period_days: 7,
          expand: ["latest_invoice"],
        }),
        {
          literals: ["status", "latest_invoice.billing_reason", "latest_invoice.status"],
          doc: { operation: "post /v1/subscriptions", status: 200 },
        },
      )
      const trialId = api.field(trial, "id")

      cancelLater(context, api, trialId)

      const active = await context.step(
        "create active subscription",
        api.call(context, "POST", "/v1/subscriptions", {
          customer,
          items: [{ price }],
          expand: ["latest_invoice.payments"],
        }),
        {
          literals: ["status", "latest_invoice.status"],
          doc: { operation: "post /v1/subscriptions", status: 200 },
        },
      )
      const activeId = api.field(active, "id")

      cancelLater(context, api, activeId)
      await context.step(
        "set to cancel at period end",
        api.call(context, "POST", `/v1/subscriptions/${activeId}`, { cancel_at_period_end: true }),
        { literals: ["status", "cancel_at_period_end"] },
      )

      const listed = await context.step(
        "list the customer's subscriptions",
        api.call(context, "GET", "/v1/subscriptions", { customer, limit: 10 }),
      )
      const data = asJsonObject(listed.body)?.["data"]

      context.fact("subscriptions listed for the customer", Array.isArray(data) ? data.length : 0)
      await context.step(
        "cancel the trial",
        api.call(context, "DELETE", `/v1/subscriptions/${trialId}`),
        {
          literals: ["status"],
          doc: { operation: "delete /v1/subscriptions/{subscription_exposed_id}", status: 200 },
        },
      )
    },
  }

  const invoices: Scenario = {
    name: "invoices: a subscription's first invoice, paid, and its list",
    async run(context) {
      const customer = await customerWithCard(context, api)
      const price = await monthlyPrice(context, api)
      const subscription = await context.step(
        "create subscription",
        api.call(context, "POST", "/v1/subscriptions", { customer, items: [{ price }] }),
      )
      const id = api.field(subscription, "id")

      cancelLater(context, api, id)
      await context.step(
        "retrieve its invoice with payments",
        api.call(context, "GET", `/v1/invoices/${nested(subscription, "latest_invoice")}`, {
          expand: ["payments"],
        }),
        {
          literals: ["status", "billing_reason", "payments.data.status"],
          doc: { operation: "get /v1/invoices/{invoice}", status: 200 },
        },
      )
      await context.step(
        "list the subscription's invoices",
        api.call(context, "GET", "/v1/invoices", { subscription: id, limit: 10 }),
        { doc: { operation: "get /v1/invoices", status: 200 } },
      )
    },
  }

  return [setupIntents, subscriptions, invoices]
}
