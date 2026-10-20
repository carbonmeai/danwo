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
        tx_ref: context.tag,
        amount: 100,
        currency: "NGN",
        redirect_url: "https://example.com/fidelity",
        customer: { email: `${context.tag}@example.com` },
      }),
      {
        literals: ["status"],
        doc: { status: 200, schema: envelope(object({ link: str })), ...success },
      },
    )
  },
}

/**
 * Whether live Flutterwave is failing its banks list in test mode: it has answered every country
 * with its generic 400 ("An error occurred") while other reads with the same key work, so a
 * mismatch would be Flutterwave's outage, not the emulator's.
 */
async function banksDown(context: ScenarioContext): Promise<boolean> {
  if (context.target.kind !== "live") return false

  const response = await context.target.send(call(context, "GET", "/v3/banks/NG"))
  const text = await response.text()

  return response.status === 400 && text.includes("An error occurred")
}

const banks: Scenario = {
  name: "banks: list",
  async run(context) {
    if (await banksDown(context))
      context.skip(
        "provider error in test mode: Flutterwave answers its generic 400 to every banks list; the emulator is still checked offline against the golden",
      )
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
  leaves:
    "each run makes one hosted payment link (tx_ref danwo-fidelity-…); Flutterwave has no API to delete them",
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
