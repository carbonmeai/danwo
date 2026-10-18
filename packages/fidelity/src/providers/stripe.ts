/**
 * Stripe's fidelity suite: customers, lists and paging, errors, idempotency, products and prices,
 * a payment intent from creation to refund, a Checkout Session and the events API. Live runs use a
 * test-mode key only.
 */
import { stripe } from "@danwo/emulators"

import { type FidelityProvider, refuseLive, requiredCredentials } from "../provider.ts"
import type { Answer, Scenario, ScenarioContext } from "../scenario.ts"
import { asJsonObject, isJsonArray } from "../shape.ts"
import { credential, emulatorTarget, formBody, liveTarget } from "../target.ts"

const API = "https://api.stripe.com"
const KEY = "DANWO_FIDELITY_STRIPE_KEY"

/** A request to Stripe's API with the target's key, form encoded as Stripe expects. */
function call(
  context: ScenarioContext,
  method: string,
  path: string,
  values?: Readonly<Record<string, unknown>>,
  headers: Readonly<Record<string, string>> = {},
): Request {
  const body = values === undefined ? undefined : formBody(values)
  const url =
    method === "GET" && body !== undefined && body !== ""
      ? `${API}${path}?${body}`
      : `${API}${path}`

  return new Request(url, {
    method,
    headers: {
      authorization: `Bearer ${credential(context.target, "key")}`,
      ...(method !== "GET" && { "content-type": "application/x-www-form-urlencoded" }),
      ...headers,
    },
    ...(method !== "GET" && body !== undefined && { body }),
  })
}

/** A string field of an answer's top-level object. */
function field(answer: Answer, name: string): string {
  const value = asJsonObject(answer.body)?.[name]

  if (typeof value !== "string") throw new Error(`expected the answer to have a string ${name}`)

  return value
}

/** The ids of a list answer's items, in order. */
function listIds(answer: Answer): string[] {
  const data = asJsonObject(answer.body)?.["data"]

  return data !== undefined && isJsonArray(data)
    ? data.flatMap((item) => {
        const id = asJsonObject(item)?.["id"]

        return typeof id === "string" ? [id] : []
      })
    : []
}

function email(context: ScenarioContext): string {
  return `fidelity+${context.unique}@example.com`
}

async function createCustomer(context: ScenarioContext, step = "create customer"): Promise<string> {
  const created = await context.step(
    step,
    call(context, "POST", "/v1/customers", { email: email(context), name: "Fidelity Check" }),
    {
      doc: { operation: "post /v1/customers", status: 200 },
    },
  )
  const id = field(created, "id")

  context.cleanup(() => context.target.send(call(context, "DELETE", `/v1/customers/${id}`)))

  return id
}

const customers: Scenario = {
  name: "customers: create, retrieve, update, delete",
  documentedFacts: [{ name: "a deleted customer reads back as deleted", value: true }],
  async run(context) {
    const id = await createCustomer(context)

    await context.step("retrieve customer", call(context, "GET", `/v1/customers/${id}`), {
      doc: { operation: "get /v1/customers/{customer}", status: 200 },
    })
    await context.step(
      "update customer",
      call(context, "POST", `/v1/customers/${id}`, {
        description: "updated by fidelity",
        metadata: { run: context.unique },
      }),
      {
        doc: { operation: "post /v1/customers/{customer}", status: 200 },
      },
    )
    await context.step("delete customer", call(context, "DELETE", `/v1/customers/${id}`), {
      literals: ["deleted"],
      doc: {
        operation: "delete /v1/customers/{customer}",
        status: 200,
        literals: { deleted: true },
      },
    })

    const gone = await context.step(
      "retrieve deleted customer",
      call(context, "GET", `/v1/customers/${id}`),
      { literals: ["deleted"] },
    )

    context.fact(
      "a deleted customer reads back as deleted",
      asJsonObject(gone.body)?.["deleted"] === true,
    )
  },
}

const paging: Scenario = {
  name: "customers: list pages, newest first",
  documentedFacts: [
    { name: "first page is newest first", value: true, kind: "ordering" },
    { name: "first page size", value: 2 },
    { name: "second page size", value: 1 },
  ],
  async run(context) {
    const ids: string[] = []

    for (const n of [1, 2, 3]) ids.push(await createCustomer(context, `create customer ${n}`))

    const first = await context.step(
      "list first page",
      call(context, "GET", "/v1/customers", { email: email(context), limit: 2 }),
      {
        literals: ["has_more"],
        doc: { operation: "get /v1/customers", status: 200, literals: { has_more: true } },
      },
    )
    const firstIds = listIds(first)
    const second = await context.step(
      "list second page",
      call(context, "GET", "/v1/customers", {
        email: email(context),
        limit: 2,
        starting_after: firstIds.at(-1),
      }),
      {
        literals: ["has_more"],
        doc: { operation: "get /v1/customers", status: 200, literals: { has_more: false } },
      },
    )

    context.fact(
      "first page is newest first",
      firstIds[0] === ids[2] && firstIds[1] === ids[1],
      "ordering",
    )
    context.fact("first page size", firstIds.length)
    context.fact("second page size", listIds(second).length)
  },
}

const errors: Scenario = {
  name: "errors: missing object, missing parameter, bad key",
  async run(context) {
    await context.step(
      "retrieve a customer that does not exist",
      call(context, "GET", "/v1/customers/cus_danwo_fidelity_missing"),
      {
        literals: ["error.type", "error.code", "error.param"],
        doc: {
          operation: "get /v1/customers/{customer}",
          status: 404,
          literals: {
            "error.type": "invalid_request_error",
            "error.code": "resource_missing",
            "error.param": "id",
          },
        },
      },
    )
    await context.step(
      "create a price without a currency",
      call(context, "POST", "/v1/prices", { unit_amount: 500, product_data: { name: "Fidelity" } }),
      {
        literals: ["error.type", "error.code", "error.param"],
        doc: {
          operation: "post /v1/prices",
          status: 400,
          literals: {
            "error.type": "invalid_request_error",
            "error.code": "parameter_missing",
            "error.param": "currency",
          },
        },
      },
    )
    await context.step(
      "call with an invalid key",
      new Request(`${API}/v1/customers`, {
        headers: { authorization: "Bearer sk_test_danwo_fidelity_not_a_key" },
      }),
      {
        literals: ["error.type"],
        doc: {
          operation: "get /v1/customers",
          status: 401,
          literals: { "error.type": "invalid_request_error" },
        },
      },
    )
  },
}

const idempotency: Scenario = {
  name: "idempotency: replay and conflicting reuse",
  documentedFacts: [
    { name: "a replay returns the same customer", value: true },
    { name: "a replay is marked as replayed", value: true },
  ],
  async run(context) {
    const key = { "idempotency-key": `danwo-fidelity-${context.unique}` }
    const values = { email: email(context) }
    const first = await context.step(
      "create with an idempotency key",
      call(context, "POST", "/v1/customers", values, key),
      {
        doc: { operation: "post /v1/customers", status: 200 },
      },
    )
    const id = field(first, "id")

    context.cleanup(() => context.target.send(call(context, "DELETE", `/v1/customers/${id}`)))

    const replay = await context.step(
      "replay the same request",
      call(context, "POST", "/v1/customers", values, key),
      {
        doc: { operation: "post /v1/customers", status: 200 },
      },
    )

    context.fact("a replay returns the same customer", field(replay, "id") === id)
    context.fact(
      "a replay is marked as replayed",
      replay.headers.get("idempotent-replayed") === "true",
    )
    await context.step(
      "reuse the key with other parameters",
      call(context, "POST", "/v1/customers", { email: `other+${context.unique}@example.com` }, key),
      {
        literals: ["error.type"],
        doc: {
          operation: "post /v1/customers",
          status: 400,
          literals: { "error.type": "idempotency_error" },
        },
      },
    )
  },
}

const prices: Scenario = {
  name: "products and prices: one-off and recurring",
  documentedFacts: [{ name: "prices listed for the product", value: 2 }],
  async run(context) {
    const product = await context.step(
      "create product",
      call(context, "POST", "/v1/products", { name: `Fidelity ${context.unique}` }),
      {
        doc: { operation: "post /v1/products", status: 200 },
      },
    )
    const productId = field(product, "id")
    const oneOff = await context.step(
      "create one-off price",
      call(context, "POST", "/v1/prices", {
        product: productId,
        unit_amount: 500,
        currency: "usd",
      }),
      {
        literals: ["type"],
        doc: { operation: "post /v1/prices", status: 200, literals: { type: "one_time" } },
      },
    )
    const monthly = await context.step(
      "create monthly price",
      call(context, "POST", "/v1/prices", {
        product: productId,
        unit_amount: 900,
        currency: "usd",
        recurring: { interval: "month" },
      }),
      {
        literals: ["type", "recurring.interval"],
        doc: {
          operation: "post /v1/prices",
          status: 200,
          literals: { type: "recurring", "recurring.interval": "month" },
        },
      },
    )
    const listed = await context.step(
      "list the product's prices",
      call(context, "GET", "/v1/prices", { product: productId, limit: 10 }),
      {
        doc: { operation: "get /v1/prices", status: 200 },
      },
    )

    context.fact("prices listed for the product", listIds(listed).length)

    for (const price of [field(oneOff, "id"), field(monthly, "id")])
      context.cleanup(() =>
        context.target.send(call(context, "POST", `/v1/prices/${price}`, { active: false })),
      )
    context.cleanup(() =>
      context.target.send(call(context, "POST", `/v1/products/${productId}`, { active: false })),
    )
  },
}

const payments: Scenario = {
  name: "payment intent: create, confirm, expand, refund",
  async run(context) {
    const created = await context.step(
      "create payment intent",
      call(context, "POST", "/v1/payment_intents", {
        amount: 2000,
        currency: "usd",
        payment_method_types: ["card"],
      }),
      {
        literals: ["status"],
        doc: {
          operation: "post /v1/payment_intents",
          status: 200,
          literals: { status: "requires_payment_method" },
        },
      },
    )
    const id = field(created, "id")

    await context.step(
      "confirm with a test card",
      call(context, "POST", `/v1/payment_intents/${id}/confirm`, {
        payment_method: "pm_card_visa",
      }),
      {
        literals: ["status"],
        doc: {
          operation: "post /v1/payment_intents/{intent}/confirm",
          status: 200,
          literals: { status: "succeeded" },
        },
      },
    )
    await context.step(
      "retrieve with the charge expanded",
      call(context, "GET", `/v1/payment_intents/${id}`, { expand: ["latest_charge"] }),
      {
        literals: ["status", "latest_charge.status"],
        doc: {
          operation: "get /v1/payment_intents/{intent}",
          status: 200,
          literals: { status: "succeeded" },
        },
      },
    )
    await context.step(
      "refund the payment",
      call(context, "POST", "/v1/refunds", { payment_intent: id }),
      {
        literals: ["status"],
        doc: { operation: "post /v1/refunds", status: 200, literals: { status: "succeeded" } },
      },
    )
  },
}

const checkout: Scenario = {
  name: "checkout session: create, retrieve, expire",
  async run(context) {
    const created = await context.step(
      "create checkout session",
      call(context, "POST", "/v1/checkout/sessions", {
        mode: "payment",
        success_url: "https://example.com/success",
        line_items: [
          {
            quantity: 1,
            price_data: { currency: "usd", unit_amount: 500, product_data: { name: "Credits" } },
          },
        ],
      }),
      {
        literals: ["status", "payment_status", "mode"],
        doc: {
          operation: "post /v1/checkout/sessions",
          status: 200,
          literals: { status: "open", payment_status: "unpaid", mode: "payment" },
        },
      },
    )
    const id = field(created, "id")

    await context.step(
      "retrieve checkout session",
      call(context, "GET", `/v1/checkout/sessions/${id}`),
      {
        literals: ["status", "payment_status", "mode"],
        doc: {
          operation: "get /v1/checkout/sessions/{session}",
          status: 200,
          literals: { status: "open" },
        },
      },
    )
    await context.step(
      "expire checkout session",
      call(context, "POST", `/v1/checkout/sessions/${id}/expire`),
      {
        literals: ["status"],
        doc: {
          operation: "post /v1/checkout/sessions/{session}/expire",
          status: 200,
          literals: { status: "expired" },
        },
      },
    )
  },
}

/**
 * The newest event of `type` once it mentions `id`. The real events list catches up a moment after
 * the call that caused the event, so it is polled a few times before the step is recorded.
 */
async function newestEvent(context: ScenarioContext, type: string, id: string): Promise<Answer> {
  for (let attempt = 1; attempt < 5; attempt++) {
    const answer = await context.target.send(call(context, "GET", "/v1/events", { type, limit: 1 }))

    if ((await answer.text()).includes(id)) break

    await new Promise((done) => setTimeout(done, 1000))
  }

  return context.step("list newest event", call(context, "GET", "/v1/events", { type, limit: 1 }), {
    doc: { operation: "get /v1/events", status: 200 },
  })
}

const events: Scenario = {
  name: "events: a created customer appears as customer.created",
  documentedFacts: [
    { name: "the newest customer.created event is about the new customer", value: true },
  ],
  async run(context) {
    const id = await createCustomer(context)
    const listed = await newestEvent(context, "customer.created", id)
    const text = JSON.stringify(listed.body)

    context.fact("the newest customer.created event is about the new customer", text.includes(id))
  },
}

export const stripeFidelity: FidelityProvider = {
  name: "stripe",
  openapi: "https://raw.githubusercontent.com/stripe/openapi/master/openapi/spec3.json",
  credentials: [
    {
      name: KEY,
      description: "a Stripe test-mode secret or restricted key (sk_test_… or rk_test_…)",
    },
  ],
  scenarios: [customers, paging, errors, idempotency, prices, payments, checkout, events],
  emulator: () => emulatorTarget(stripe, { key: "sk_test_danwo_fidelity" }),
  live(env) {
    const found = requiredCredentials(this, env)
    const key = found?.[KEY]

    if (key === undefined) return undefined

    refuseLive("Stripe", KEY, key, [/^(?!(sk|rk)_test_)/])

    return liveTarget({ key })
  },
}
