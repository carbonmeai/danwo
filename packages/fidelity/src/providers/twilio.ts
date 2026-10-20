/**
 * Twilio's fidelity suite. It runs one of two ways, by what the credentials are:
 *
 * - Test credentials (Twilio answers 403 to reading the account): the magic numbers, a message from
 *   the always-valid test sender and the refusals for an invalid recipient and an unowned sender.
 *   Test credentials send nothing and bill nothing.
 * - Live credentials, an Auth Token or an API key: nothing is ever sent. The suite reads the account,
 *   its numbers and its messages, and makes only requests Twilio refuses before a message exists:
 *   bad credentials, a message that isn't there, no recipient, and the refusals a trial or a full
 *   account gives for a malformed recipient, an unverified recipient or a sender it doesn't own.
 *   Every refused send names a `From` the account is first checked not to own, and never a
 *   Messaging Service, so none can go out; afterwards the account's messages to that recipient are
 *   counted, and must be none. A successful send's shape is checked against the published API
 *   reference only.
 */
import { seedTwilio, twilio } from "@danwo/emulators"

import { type FidelityProvider, requiredCredentials } from "../provider.ts"
import type { Answer, Scenario, ScenarioContext, StepDoc } from "../scenario.ts"
import { nullable, num, object, str } from "../schema.ts"
import { credential, emulatorTarget, liveTarget } from "../target.ts"

const API = "https://api.twilio.com/2010-04-01"
const SID = "DANWO_FIDELITY_TWILIO_ACCOUNT_SID"
const TOKEN = "DANWO_FIDELITY_TWILIO_AUTH_TOKEN"
const KEY_SID = "DANWO_FIDELITY_TWILIO_API_KEY_SID"
const KEY_SECRET = "DANWO_FIDELITY_TWILIO_API_KEY_SECRET"
const MESSAGES = "post /2010-04-01/Accounts/{AccountSid}/Messages.json"

/** Twilio's magic numbers for test credentials. */
const VALID_FROM = "+15005550006"
const INVALID_TO = "+15005550001"
const UNOWNED_FROM = "+15005550007"
/** A fictional number (555-01xx) to address refused sends to. */
const RECIPIENT = "+14155550100"
/** A fictional sender that a live account is checked not to own before any send names it. */
const NOT_OURS = "+14155550123"

/** The emulator's accounts: test credentials, a trial account and a full one. */
const ACCOUNTS = {
  test: { sid: `AC${"d".repeat(32)}`, token: "danwo-fidelity" },
  trial: { sid: `AC${"e".repeat(32)}`, token: "danwo-fidelity-trial" },
  full: { sid: `AC${"f".repeat(32)}`, token: "danwo-fidelity-full" },
} as const

type Kind = keyof typeof ACCOUNTS

const SKIP_SEND =
  "the credentials are live, so nothing is sent; a successful send's shape is checked against the published API reference only"

/** Twilio's error body, which its API description leaves out. */
const ERROR = object(
  { code: num, message: str, more_info: str, status: num },
  { details: nullable({}) },
)

function errorDoc(status: number, code: number): StepDoc {
  return { schema: ERROR, status, literals: { code, status } }
}

/** Who a request is made as: the account in the path, and the Basic credentials. */
interface Caller {
  readonly sid: string
  readonly user: string
  readonly password: string
}

/** The account a scenario calls as: on the emulator the one of `kind`, live the configured one. */
function callerFor(context: ScenarioContext, kind: Kind): Caller {
  if (context.target.kind === "emulator") {
    const { sid, token } = ACCOUNTS[kind]

    return { sid, user: sid, password: token }
  }

  return {
    sid: credential(context.target, "sid"),
    user: credential(context.target, "user"),
    password: credential(context.target, "password"),
  }
}

function basic(user: string, password: string): string {
  return `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}`
}

function read(caller: Caller, path: string, password = caller.password): Request {
  return new Request(`${API}/Accounts/${caller.sid}${path}`, {
    headers: { authorization: basic(caller.user, password) },
  })
}

function send(caller: Caller, fields: Readonly<Record<string, string>>): Request {
  return new Request(`${API}/Accounts/${caller.sid}/Messages.json`, {
    method: "POST",
    headers: {
      authorization: basic(caller.user, caller.password),
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(fields),
  })
}

/**
 * What the live credentials are: `test` when Twilio refuses to read the account (403), else the
 * account's type. The emulator plays every kind, so it never decides.
 */
async function liveKind(context: ScenarioContext): Promise<Kind | undefined> {
  if (context.target.kind === "emulator") return undefined

  const response = await context.target.send(read(callerFor(context, "full"), ".json"))

  if (response.status === 403) {
    await response.body?.cancel()

    return "test"
  }

  if (response.status !== 200) {
    await response.body?.cancel()
    context.skip(`reading the account answered ${response.status}`)
  }

  const account: unknown = await response.json()
  const type =
    typeof account === "object" && account !== null && "type" in account ? account.type : undefined

  return type === "Trial" ? "trial" : "full"
}

/** Runs only where the credentials are of `kind`, skipping with `reason` elsewhere. */
async function onlyFor(context: ScenarioContext, kinds: readonly Kind[], reason: string) {
  const kind = await liveKind(context)

  if (kind !== undefined && !kinds.includes(kind)) context.skip(reason)
}

/**
 * Stops unless the account owns no number called {@link NOT_OURS}, the sender every refused send
 * names: a send can only go out from a number the account owns.
 */
async function ensureNotOurs(context: ScenarioContext, caller: Caller): Promise<void> {
  const response = await context.target.send(
    read(caller, "/IncomingPhoneNumbers.json?PageSize=1000"),
  )
  const page: unknown = await response.json()
  const numbers =
    typeof page === "object" && page !== null && "incoming_phone_numbers" in page
      ? page.incoming_phone_numbers
      : undefined

  if (response.status !== 200 || !Array.isArray(numbers))
    context.skip(`listing the account's numbers answered ${response.status}`)
  if (JSON.stringify(numbers).includes(NOT_OURS))
    context.skip(`the account owns ${NOT_OURS}, so refused sends could go out`)
}

/** Records how many messages the account holds to {@link RECIPIENT}: none, since every send was refused. */
async function countSent(context: ScenarioContext, caller: Caller): Promise<void> {
  const answer: Answer = await context.step(
    "the account's messages to the recipient",
    read(caller, `/Messages.json?To=${encodeURIComponent(RECIPIENT)}&PageSize=20`),
    { doc: { operation: "get /2010-04-01/Accounts/{AccountSid}/Messages.json", status: 200 } },
  )
  const listed =
    typeof answer.body === "object" && answer.body !== null && "messages" in answer.body
      ? answer.body.messages
      : undefined

  context.fact("messages created", Array.isArray(listed) ? listed.length : -1)
}

const errorLiterals = { literals: ["code", "status"] }

const sendMessage: Scenario = {
  name: "messages: send from the test number",
  async run(context) {
    await onlyFor(context, ["test"], SKIP_SEND)
    await context.step(
      "send a message",
      send(callerFor(context, "test"), {
        From: VALID_FROM,
        To: RECIPIENT,
        Body: `danwo fidelity ${context.unique}`,
      }),
      {
        literals: ["status", "direction"],
        doc: { operation: MESSAGES, status: 201, literals: { status: "queued" } },
      },
    )
  },
}

const refusals: Scenario = {
  name: "messages: invalid recipient, unowned sender",
  async run(context) {
    const caller = callerFor(context, "test")
    const body = `danwo fidelity ${context.unique}`

    await onlyFor(context, ["test"], "Twilio's magic numbers answer only to test credentials")
    await context.step(
      "send to an invalid number",
      send(caller, { From: VALID_FROM, To: INVALID_TO, Body: body }),
      { ...errorLiterals, doc: errorDoc(400, 21211) },
    )
    await context.step(
      "send from a number not owned",
      send(caller, { From: UNOWNED_FROM, To: RECIPIENT, Body: body }),
      { ...errorLiterals, doc: errorDoc(400, 21606) },
    )
  },
}

const accountReads: Scenario = {
  name: "account: the account, its numbers and its messages",
  async run(context) {
    const caller = callerFor(context, "trial")

    await onlyFor(context, ["trial", "full"], "test credentials cannot read the account")
    await context.step("read the account", read(caller, ".json"), {
      literals: ["status"],
      doc: { operation: "get /2010-04-01/Accounts/{Sid}.json", status: 200 },
    })
    await context.step("list the numbers", read(caller, "/IncomingPhoneNumbers.json?PageSize=50"), {
      doc: {
        operation: "get /2010-04-01/Accounts/{AccountSid}/IncomingPhoneNumbers.json",
        status: 200,
      },
    })
    await context.step("list the messages", read(caller, "/Messages.json?PageSize=20"), {
      doc: { operation: "get /2010-04-01/Accounts/{AccountSid}/Messages.json", status: 200 },
    })
  },
}

const errors: Scenario = {
  name: "errors: bad credentials, a missing message, no recipient",
  async run(context) {
    const caller = callerFor(context, "trial")

    await onlyFor(context, ["trial", "full"], "test credentials cannot read the account")
    await context.step("read with a wrong secret", read(caller, ".json", "danwo-wrong-secret"), {
      ...errorLiterals,
      doc: errorDoc(401, 20003),
    })
    await context.step(
      "read a message that isn't there",
      read(caller, `/Messages/SM${"0".repeat(32)}.json`),
      { ...errorLiterals, doc: errorDoc(404, 20404) },
    )
    await context.step(
      "send with no recipient",
      send(caller, { From: NOT_OURS, Body: `danwo fidelity ${context.unique}` }),
      { ...errorLiterals, doc: errorDoc(400, 21604) },
    )
  },
}

const trialRefusals: Scenario = {
  name: "messages: a trial account's refusals",
  async run(context) {
    const caller = callerFor(context, "trial")
    const body = `danwo fidelity ${context.unique}`

    await onlyFor(context, ["trial"], "the account is not a trial one")
    await ensureNotOurs(context, caller)
    await context.step(
      "send to a malformed number",
      send(caller, { From: NOT_OURS, To: "not-a-number", Body: body }),
      { ...errorLiterals, doc: errorDoc(400, 0) },
    )
    await context.step(
      "send to an unverified number",
      send(caller, { From: NOT_OURS, To: RECIPIENT, Body: body }),
      { ...errorLiterals, doc: errorDoc(422, 572002) },
    )
    await context.step("send with no body", send(caller, { From: NOT_OURS, To: RECIPIENT }), {
      ...errorLiterals,
      doc: errorDoc(400, 0),
    })
    await countSent(context, caller)
  },
}

const fullRefusals: Scenario = {
  name: "messages: a full account's refusals",
  async run(context) {
    const caller = callerFor(context, "full")
    const body = `danwo fidelity ${context.unique}`

    await onlyFor(context, ["full"], "the account is not a full one")
    await ensureNotOurs(context, caller)
    await context.step(
      "send to a malformed number",
      send(caller, { From: NOT_OURS, To: "not-a-number", Body: body }),
      { ...errorLiterals, doc: errorDoc(400, 21211) },
    )
    await context.step(
      "send from a number not owned",
      send(caller, { From: NOT_OURS, To: RECIPIENT, Body: body }),
      { ...errorLiterals, doc: errorDoc(400, 21606) },
    )
    await countSent(context, caller)
  },
}

export const twilioFidelity: FidelityProvider = {
  name: "twilio",
  leaves:
    "nothing: test credentials never send, and live ones only read and make sends Twilio refuses",
  openapi:
    "https://raw.githubusercontent.com/twilio/twilio-oai/main/spec/json/twilio_api_v2010.json",
  credentials: [
    { name: SID, description: "the Account SID (test or live)" },
    {
      name: KEY_SID,
      description: "an API key's SID (SK…), preferred over the Auth Token",
      optional: true,
    },
    { name: KEY_SECRET, description: "that API key's secret", optional: true },
    {
      name: TOKEN,
      description: "the Auth Token, when no API key is set (test or live)",
      optional: true,
    },
  ],
  scenarios: [sendMessage, refusals, accountReads, errors, trialRefusals, fullRefusals],
  emulator: () =>
    emulatorTarget(twilio, {}, (emulator) =>
      seedTwilio(emulator.store, {
        accounts: [
          { sid: ACCOUNTS.test.sid, authToken: ACCOUNTS.test.token },
          { sid: ACCOUNTS.trial.sid, authToken: ACCOUNTS.trial.token, type: "Trial" },
          { sid: ACCOUNTS.full.sid, authToken: ACCOUNTS.full.token },
        ],
        numbers: [{ number: VALID_FROM, account: ACCOUNTS.test.sid }],
      }),
    ),
  live(env) {
    const found = requiredCredentials(this, env)
    const sid = found?.[SID]
    const keySid = found?.[KEY_SID]
    const keySecret = found?.[KEY_SECRET]
    const token = found?.[TOKEN]

    if (sid === undefined) return undefined
    if (keySid !== undefined && keySecret !== undefined)
      return liveTarget({ sid, user: keySid, password: keySecret })

    return token === undefined ? undefined : liveTarget({ sid, user: sid, password: token })
  },
}
