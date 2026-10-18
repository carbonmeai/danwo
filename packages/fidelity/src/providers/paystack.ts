/**
 * Paystack's fidelity suite: initializing and verifying a transaction, creating and fetching a
 * customer, the bank list, and the errors for an unknown reference and a bad key. Paystack
 * publishes no API description, so the documented answers are written here from its reference.
 */
import { paystack, seedPaystack } from "@danwo/emulators"

import { type FidelityProvider, refuseLive, requiredCredentials } from "../provider.ts"
import type { Scenario, ScenarioContext } from "../scenario.ts"
import { arrayOf, bool, map, nullable, num, object, partialObject, str } from "../schema.ts"
import { asJsonObject, type Json } from "../shape.ts"
import { bearerRequest, emulatorTarget, liveTarget } from "../target.ts"

const API = "https://api.paystack.co"
const KEY = "DANWO_FIDELITY_PAYSTACK_KEY"
const EMULATOR_KEY = "sk_test_danwo_fidelity"

/** Every Paystack answer: `status`, `message`, and the payload under `data`. */
function envelope(data: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
  return object({ status: bool, message: str, data })
}

const ERROR = object(
  { status: bool, message: str },
  { meta: map, type: str, code: str, data: nullable(map) },
)

const TRANSACTION = partialObject({
  id: num,
  domain: str,
  status: str,
  reference: str,
  amount: num,
  currency: str,
  channel: str,
  created_at: str,
  customer: partialObject({ id: num, email: str, customer_code: str }),
  metadata: nullable(map),
})

const CUSTOMER = partialObject({
  id: num,
  email: str,
  customer_code: str,
  integration: num,
  domain: str,
  createdAt: str,
  updatedAt: str,
})

const BANK = partialObject({
  id: num,
  name: str,
  slug: str,
  code: str,
  active: bool,
  country: str,
  currency: str,
  type: str,
})

const OK = { literals: { status: true } }

function call(context: ScenarioContext, method: string, path: string, body?: unknown): Request {
  return bearerRequest(context.target, method, `${API}${path}`, body)
}

function dataField(body: Json, field: string): string {
  const value = asJsonObject(asJsonObject(body)?.["data"])?.[field]

  if (typeof value !== "string") throw new Error(`expected data.${field} in the answer`)

  return value
}

function email(context: ScenarioContext): string {
  return `fidelity-${context.unique}@example.com`
}

const transactions: Scenario = {
  name: "transactions: initialize and verify",
  async run(context) {
    const started = await context.step(
      "initialize a transaction",
      call(context, "POST", "/transaction/initialize", { email: email(context), amount: 50000 }),
      {
        literals: ["status"],
        doc: {
          status: 200,
          schema: envelope(object({ authorization_url: str, access_code: str, reference: str })),
          ...OK,
        },
      },
    )

    await context.step(
      "verify the unpaid transaction",
      call(context, "GET", `/transaction/verify/${dataField(started.body, "reference")}`),
      { literals: ["status"], doc: { status: 200, schema: envelope(TRANSACTION), ...OK } },
    )
  },
}

const customers: Scenario = {
  name: "customers: create and fetch",
  async run(context) {
    const created = await context.step(
      "create a customer",
      call(context, "POST", "/customer", { email: email(context), first_name: "Fidelity" }),
      { literals: ["status"], doc: { status: 200, schema: envelope(CUSTOMER), ...OK } },
    )

    await context.step(
      "fetch the customer",
      call(context, "GET", `/customer/${dataField(created.body, "customer_code")}`),
      { literals: ["status"], doc: { status: 200, schema: envelope(CUSTOMER), ...OK } },
    )
  },
}

const banks: Scenario = {
  name: "banks: list",
  async run(context) {
    await context.step("list banks", call(context, "GET", "/bank?country=nigeria&perPage=5"), {
      literals: ["status"],
      doc: {
        status: 200,
        schema: object(
          { status: bool, message: str, data: arrayOf(BANK) },
          {
            meta: partialObject({}, { next: nullable(str), previous: nullable(str), perPage: num }),
          },
        ),
        ...OK,
      },
    })
  },
}

const errors: Scenario = {
  name: "errors: unknown reference, bad key",
  async run(context) {
    await context.step(
      "verify an unknown reference",
      call(context, "GET", `/transaction/verify/danwo-missing-${context.unique}`),
      { literals: ["status"], doc: { status: 400, schema: ERROR, literals: { status: false } } },
    )
    await context.step(
      "call with a bad key",
      new Request(`${API}/transaction/verify/x`, {
        headers: { authorization: "Bearer sk_test_not_a_real_key" },
      }),
      { literals: ["status"], doc: { status: 401, schema: ERROR, literals: { status: false } } },
    )
  },
}

export const paystackFidelity: FidelityProvider = {
  name: "paystack",
  credentials: [{ name: KEY, description: "a Paystack test secret key (sk_test_…)" }],
  scenarios: [transactions, customers, banks, errors],
  emulator: () =>
    emulatorTarget(paystack, { key: EMULATOR_KEY }, (emulator) =>
      seedPaystack(emulator.store, { integrations: [{ secretKey: EMULATOR_KEY }] }),
    ),
  live(env) {
    const key = requiredCredentials(this, env)?.[KEY]

    if (key === undefined) return undefined

    refuseLive("Paystack", KEY, key, [/^(?!sk_test_)/])

    return liveTarget({ key })
  },
}
