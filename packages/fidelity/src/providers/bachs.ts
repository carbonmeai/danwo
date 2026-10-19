/**
 * Bachs's fidelity suite on its sandbox: creating, fetching and listing customers, and its flat
 * error object for an unknown customer, a missing key and a failed validation. The documented
 * answers are written here from the Bachs API reference.
 */
import { bachs } from "@danwo/emulators"

import { type FidelityProvider, refuseLive, requiredCredentials } from "../provider.ts"
import type { Scenario, ScenarioContext, StepDoc } from "../scenario.ts"
import { arrayOf, map, nullable, object, partialObject, str } from "../schema.ts"
import { asJsonObject, type Json } from "../shape.ts"
import { bearerRequest, emulatorTarget, liveTarget } from "../target.ts"

const API = "https://sandbox-api.bachs.io"
const KEY = "DANWO_FIDELITY_BACHS_KEY"

/**
 * The email a run's customer is created with. Bachs refuses an address whose domain takes no mail,
 * which rules out every reserved name, so runs use Resend's test inbox: a real domain that accepts
 * mail and keeps none.
 */
function inbox(context: ScenarioContext): string {
  return `delivered+danwo-fidelity-${context.unique}@resend.dev`
}

const ADDRESS = object({
  line1: nullable(str),
  line2: nullable(str),
  city: nullable(str),
  state: nullable(str),
  postal_code: nullable(str),
  country: nullable(str),
})

const CUSTOMER = partialObject({
  customer_id: str,
  email: str,
  name: nullable(str),
  phone_number: nullable(str),
  metadata: map,
  billing_address: nullable(ADDRESS),
  created_at: str,
  updated_at: str,
})

const ERROR = object(
  { error_code: str, detail: str },
  {
    doc_url: str,
    errors: arrayOf(partialObject({ field: str, message: str })),
    details: map,
  },
)

const ERROR_LITERALS = ["error_code"]

function errorDoc(status: number, code: string): StepDoc {
  return { schema: ERROR, status, literals: { error_code: code } }
}

function call(context: ScenarioContext, method: string, path: string, body?: unknown): Request {
  return bearerRequest(context.target, method, `${API}${path}`, body)
}

function customerId(body: Json): string {
  const id = asJsonObject(body)?.["customer_id"]

  if (typeof id !== "string") throw new Error("expected the answer to carry a customer_id")

  return id
}

const customers: Scenario = {
  name: "customers: create, fetch and list",
  async run(context) {
    const created = await context.step(
      "create a customer",
      call(context, "POST", "/v1/customers", {
        email: inbox(context),
        name: "Danwo Fidelity",
        metadata: { suite: "fidelity" },
        billing_address: { line1: "40 Yaba Road", city: "Lagos", country: "NG" },
      }),
      { doc: { status: 201, schema: CUSTOMER } },
    )

    await context.step(
      "fetch the customer",
      call(context, "GET", `/v1/customers/${customerId(created.body)}`),
      {
        doc: { status: 200, schema: CUSTOMER },
      },
    )
    await context.step("list customers", call(context, "GET", "/v1/customers?limit=2"), {
      doc: { status: 200, schema: object({ items: arrayOf(CUSTOMER), pagination: map }) },
    })
  },
}

const errors: Scenario = {
  name: "errors: not found, missing key, validation",
  async run(context) {
    await context.step(
      "fetch an unknown customer",
      call(context, "GET", "/v1/customers/cust_danwofidelitymissing"),
      { literals: ERROR_LITERALS, doc: errorDoc(404, "NOT_FOUND") },
    )
    await context.step("call without a key", new Request(`${API}/v1/customers`), {
      literals: ERROR_LITERALS,
      doc: errorDoc(401, "UNAUTHORIZED"),
    })
    await context.step(
      "create a customer without an email",
      call(context, "POST", "/v1/customers", { name: "No email" }),
      { literals: ERROR_LITERALS, doc: errorDoc(400, "VALIDATION_ERROR") },
    )
  },
}

export const bachsFidelity: FidelityProvider = {
  name: "bachs",
  credentials: [{ name: KEY, description: "a Bachs sandbox secret key (sk_sandbox_…)" }],
  scenarios: [customers, errors],
  emulator: () => emulatorTarget(bachs, { key: "sk_sandbox_danwo_fidelity" }),
  live(env) {
    const key = requiredCredentials(this, env)?.[KEY]

    if (key === undefined) return undefined

    refuseLive("Bachs", KEY, key, [/^(?!sk_sandbox_)/])

    return liveTarget({ key })
  },
}
