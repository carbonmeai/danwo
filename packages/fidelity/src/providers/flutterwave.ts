/**
 * Flutterwave's fidelity suite: a hosted payment link, the bank list, and the key errors.
 * Flutterwave publishes no API description, so the documented answers are written here from its
 * reference.
 */
import { flutterwave } from "@danwo/emulators"

import { type FidelityProvider, refuseLive, requiredCredentials } from "../provider.ts"
import type { Scenario, ScenarioContext } from "../scenario.ts"
import { arrayOf, nullable, num, object, partialObject, str, anything } from "../schema.ts"
import { bearerRequest, emulatorTarget, liveTarget } from "../target.ts"

const API = "https://api.flutterwave.com"
const KEY = "DANWO_FIDELITY_FLUTTERWAVE_KEY"

/** Every Flutterwave answer: `status` (`success` or `error`), `message`, and `data`. */
function envelope(data: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
  return object({ status: str, message: str, data })
}

const ERROR = object({ status: str, message: str }, { data: nullable(anything) })

function call(context: ScenarioContext, method: string, path: string, body?: unknown): Request {
  return bearerRequest(context.target, method, `${API}${path}`, body)
}

const success = { literals: { status: "success" } }

const paymentLink: Scenario = {
  name: "payments: hosted link",
  async run(context) {
    await context.step(
      "create a payment link",
      call(context, "POST", "/v3/payments", {
        tx_ref: `danwo-fidelity-${context.unique}`,
        amount: 100,
        currency: "NGN",
        redirect_url: "https://example.com/fidelity",
        customer: { email: `fidelity-${context.unique}@example.com` },
      }),
      {
        literals: ["status"],
        doc: { status: 200, schema: envelope(object({ link: str })), ...success },
      },
    )
  },
}

const banks: Scenario = {
  name: "banks: list",
  async run(context) {
    await context.step("list Nigerian banks", call(context, "GET", "/v3/banks/NG"), {
      literals: ["status"],
      doc: {
        status: 200,
        schema: envelope(arrayOf(partialObject({ id: num, code: str, name: str }))),
        ...success,
      },
    })
  },
}

const errors: Scenario = {
  name: "errors: missing key, bad key",
  async run(context) {
    const error = { literals: { status: "error" } }

    await context.step("call without a key", new Request(`${API}/v3/banks/NG`), {
      literals: ["status"],
      doc: { status: 401, schema: ERROR, ...error },
    })
    await context.step(
      "call with a bad key",
      new Request(`${API}/v3/banks/NG`, {
        headers: { authorization: "Bearer REDACTED-TEST-VALUE" },
      }),
      { literals: ["status"], doc: { status: 401, schema: ERROR, ...error } },
    )
  },
}

export const flutterwaveFidelity: FidelityProvider = {
  name: "flutterwave",
  credentials: [{ name: KEY, description: "a Flutterwave test secret key (FLWSECK_TEST-…)" }],
  scenarios: [paymentLink, banks, errors],
  emulator: () => emulatorTarget(flutterwave, { key: "REDACTED-TEST-VALUE" }),
  live(env) {
    const key = requiredCredentials(this, env)?.[KEY]

    if (key === undefined) return undefined

    refuseLive("Flutterwave", KEY, key, [/^(?!FLWSECK_TEST-)/])

    return liveTarget({ key })
  },
}
