/**
 * Twilio's fidelity suite, built on its test credentials and magic numbers: a message from the
 * always-valid test sender, and the refusals for an invalid recipient and a sender the account does
 * not own. Test credentials send nothing and cannot read messages back, so the suite only creates.
 */
import { seedTwilio, twilio } from "@danwo/emulators"

import { type FidelityProvider, requiredCredentials } from "../provider.ts"
import type { Scenario, ScenarioContext, StepDoc } from "../scenario.ts"
import { nullable, num, object, str } from "../schema.ts"
import { credential, emulatorTarget, liveTarget } from "../target.ts"

const API = "https://api.twilio.com/2010-04-01"
const SID = "DANWO_FIDELITY_TWILIO_ACCOUNT_SID"
const TOKEN = "DANWO_FIDELITY_TWILIO_AUTH_TOKEN"
const MESSAGES = "post /2010-04-01/Accounts/{AccountSid}/Messages.json"

/** Twilio's magic numbers for test credentials. */
const VALID_FROM = "+15005550006"
const INVALID_TO = "+15005550001"
const UNOWNED_FROM = "+15005550007"
const RECIPIENT = "+14155550100"

const EMULATOR_SID = `AC${"d".repeat(32)}`

/** Twilio's error body, which its API description leaves out. */
const ERROR = object(
  { code: num, message: str, more_info: str, status: num },
  { details: nullable({}) },
)

function errorDoc(status: number, code: number): StepDoc {
  return { schema: ERROR, status, literals: { code, status } }
}

function send(context: ScenarioContext, from: string, to: string): Request {
  const sid = credential(context.target, "sid")
  const basic = Buffer.from(`${sid}:${credential(context.target, "token")}`).toString("base64")

  return new Request(`${API}/Accounts/${sid}/Messages.json`, {
    method: "POST",
    headers: {
      authorization: `Basic ${basic}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ From: from, To: to, Body: `danwo fidelity ${context.unique}` }),
  })
}

const sendMessage: Scenario = {
  name: "messages: send from the test number",
  async run(context) {
    await context.step("send a message", send(context, VALID_FROM, RECIPIENT), {
      literals: ["status", "direction"],
      doc: { operation: MESSAGES, status: 201, literals: { status: "queued" } },
    })
  },
}

const refusals: Scenario = {
  name: "messages: invalid recipient, unowned sender",
  async run(context) {
    const literals = ["code", "status"]

    await context.step("send to an invalid number", send(context, VALID_FROM, INVALID_TO), {
      literals,
      doc: errorDoc(400, 21211),
    })
    await context.step("send from a number not owned", send(context, UNOWNED_FROM, RECIPIENT), {
      literals,
      doc: errorDoc(400, 21606),
    })
  },
}

export const twilioFidelity: FidelityProvider = {
  name: "twilio",
  openapi:
    "https://raw.githubusercontent.com/twilio/twilio-oai/main/spec/json/twilio_api_v2010.json",
  credentials: [
    { name: SID, description: "the Account SID of Twilio's test credentials" },
    {
      name: TOKEN,
      description: "the test auth token (Console › Account › API keys › Test credentials)",
    },
  ],
  scenarios: [sendMessage, refusals],
  emulator: () =>
    emulatorTarget(twilio, { sid: EMULATOR_SID, token: "danwo-fidelity" }, (emulator) =>
      seedTwilio(emulator.store, {
        accounts: [{ sid: EMULATOR_SID, authToken: "danwo-fidelity" }],
        numbers: [{ number: VALID_FROM }],
      }),
    ),
  live(env) {
    const found = requiredCredentials(this, env)
    const sid = found?.[SID]
    const token = found?.[TOKEN]

    return sid === undefined || token === undefined ? undefined : liveTarget({ sid, token })
  },
}
