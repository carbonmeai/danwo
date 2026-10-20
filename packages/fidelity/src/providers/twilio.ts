/**
 * Twilio's fidelity suite. It runs one of two ways, by what the credentials are:
 *
 * - Test credentials (Twilio answers 403 to reading the account): the magic numbers, a message from
 *   the always-valid test sender and the refusals for an invalid recipient and an unowned sender.
 *   Test credentials send nothing and bill nothing.
 * - Live credentials, an Auth Token or an API key: the suite reads the account, its numbers and its
 *   messages, and makes requests Twilio refuses before a message exists: bad credentials, a message
 *   that isn't there, no recipient, and the refusals a trial or a full account gives for a
 *   malformed recipient, an unverified recipient or a sender it doesn't own. Every refused send
 *   names a `From` the account is first checked not to own, and never a Messaging Service, so none
 *   can go out; afterwards the account's messages to that recipient are counted, and must be none.
 * - One real send, only when the account's own number and a recipient are configured: a full
 *   account sends a message, follows it until it settles, reads and lists it, then deletes it. A
 *   trial account can send only a predefined template and can neither delete nor redact what it
 *   sent, so it sends only with an explicit opt-in, and the message it keeps is reported.
 */
import { seedTwilio, twilio } from "@danwo/emulators"

import { type FidelityProvider, requiredCredentials } from "../provider.ts"
import type { Answer, Scenario, ScenarioContext, StepDoc } from "../scenario.ts"
import { nullable, num, object, str } from "../schema.ts"
import { asJsonObject } from "../shape.ts"
import { credential, emulatorTarget, liveTarget } from "../target.ts"

const API = "https://api.twilio.com/2010-04-01"
const SID = "DANWO_FIDELITY_TWILIO_ACCOUNT_SID"
const TOKEN = "DANWO_FIDELITY_TWILIO_AUTH_TOKEN"
const KEY_SID = "DANWO_FIDELITY_TWILIO_API_KEY_SID"
const KEY_SECRET = "DANWO_FIDELITY_TWILIO_API_KEY_SECRET"
/** The account's own number and a recipient (a verified one on a trial account), for a real send. */
const FROM = "DANWO_FIDELITY_TWILIO_FROM"
const TO = "DANWO_FIDELITY_TWILIO_TO"
/** `1` lets a trial account send, though the message then stays in its log. */
const SEND_ON_TRIAL = "DANWO_FIDELITY_TWILIO_SEND_ON_TRIAL"
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

/** The emulator's sender and recipient for a real send, owned and verified by each account. */
const EMULATOR_NUMBERS = {
  trial: { from: "+14155550140", to: "+14155550141" },
  full: { from: "+14155550150", to: "+14155550151" },
} as const

/** The template a trial account sends, since it cannot write its own text. */
const TRIAL_TEMPLATE = "sms_internal_alerts"

const SETTLED = new Set(["delivered", "undelivered", "failed"])

/**
 * The account's own number and a recipient for one real send: live, the configured
 * `DANWO_FIDELITY_TWILIO_FROM` and `_TO` (skipping without them); on the emulator, numbers it
 * seeds for the account.
 */
function sendNumbers(context: ScenarioContext, kind: "trial" | "full") {
  if (context.target.kind === "emulator") return EMULATOR_NUMBERS[kind]

  const { from, to } = context.target.credentials

  if (from === undefined || to === undefined)
    context.skip(`a real send needs ${FROM} and ${TO}: the account's number and a recipient`)

  return { from, to }
}

/** The message `sid` once its status has settled, or as it stands after about a minute. */
async function settledMessage(context: ScenarioContext, caller: Caller, sid: string) {
  for (let attempt = 0; attempt < 40; attempt++) {
    const response = await context.target.send(read(caller, `/Messages/${sid}.json`))
    const message: unknown = await response.json()
    const status =
      typeof message === "object" && message !== null && "status" in message
        ? message.status
        : undefined

    if (typeof status === "string" && SETTLED.has(status)) return status
    await new Promise((resolve) => setTimeout(resolve, 1500))
  }

  return "unsettled"
}

/** The sid of a created message, from its answer. */
function sidOf(answer: Answer): string {
  const sid = asJsonObject(answer.body)?.["sid"]

  return typeof sid === "string" ? sid : ""
}

/**
 * Sends one message, follows it until it settles, reads and lists it, then deletes it. A trial
 * account can neither delete nor redact a message, so what it sends stays in its log: it sends
 * only when {@link SEND_ON_TRIAL} says so, and the kept message is reported as a fact.
 */
async function sendOne(context: ScenarioContext, kind: "trial" | "full", body: string) {
  const caller = callerFor(context, kind)
  const { from, to } = sendNumbers(context, kind)
  const answer = await context.step(
    "send one message",
    send(caller, { From: from, To: to, Body: body }),
    {
      literals: ["status", "direction"],
      doc: { operation: MESSAGES, status: 201, literals: { status: "queued" } },
    },
  )
  const sid = sidOf(answer)

  if (sid === "") return
  context.created({
    kind: "message",
    id: sid,
    undo: async () => {
      /* Twilio deletes a message only once it is no longer in flight. */
      await settledMessage(context, caller, sid)

      return context.target.send(deleteRequest(caller, sid))
    },
    ...(kind === "trial" && {
      unremovable: "a Twilio trial account can neither delete nor redact the messages it sends",
    }),
  })
  context.fact("settled status", await settledMessage(context, caller, sid))
  await context.step("read the message", read(caller, `/Messages/${sid}.json`), {
    literals: ["direction"],
    doc: { operation: "get /2010-04-01/Accounts/{AccountSid}/Messages/{Sid}.json", status: 200 },
  })
  await context.step(
    "list it by recipient",
    read(caller, `/Messages.json?To=${encodeURIComponent(to)}&PageSize=5`),
    { doc: { operation: "get /2010-04-01/Accounts/{AccountSid}/Messages.json", status: 200 } },
  )

  if (kind === "trial") {
    await context.step("try to delete it", deleteRequest(caller, sid), {
      ...errorLiterals,
      doc: errorDoc(401, 20003),
    })
    context.fact("kept in the account's log", "a trial account cannot delete or redact messages")
  }
}

function deleteRequest(caller: Caller, sid: string): Request {
  return new Request(`${API}/Accounts/${caller.sid}/Messages/${sid}.json`, {
    method: "DELETE",
    headers: { authorization: basic(caller.user, caller.password) },
  })
}

const trialSend: Scenario = {
  name: "messages: a trial account sends a template",
  async run(context) {
    await onlyFor(context, ["trial"], "the account is not a trial one")
    if (context.target.kind === "live" && context.target.credentials["sendOnTrial"] !== "1")
      context.skip(
        `a trial account keeps every message it sends (it cannot delete or redact them); set ${SEND_ON_TRIAL}=1 to send one anyway`,
      )
    await sendOne(context, "trial", TRIAL_TEMPLATE)
  },
}

const fullSend: Scenario = {
  name: "messages: a full account sends, then deletes",
  async run(context) {
    await onlyFor(context, ["full"], "the account is not a full one")
    await sendOne(context, "full", `danwo fidelity ${context.unique}`)
  },
}

export const twilioFidelity: FidelityProvider = {
  name: "twilio",
  leaves:
    "nothing, unless a real send is set up: a full account deletes the one message it sends; a trial account keeps it, and sends only with DANWO_FIDELITY_TWILIO_SEND_ON_TRIAL=1",
  openapi:
    "https://raw.githubusercontent.com/twilio/twilio-oai/main/spec/json/twilio_api_v2010.json",
  credentials: [
    { name: SID, description: "the Account SID (test or live)" },
    {
      name: FROM,
      description: "the account's own number, for one real send per run",
      optional: true,
    },
    {
      name: TO,
      description: "the recipient of that send; a trial account's must be verified",
      optional: true,
    },
    {
      name: SEND_ON_TRIAL,
      description: "1 to let a trial account send, though it keeps the message",
      optional: true,
    },
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
  scenarios: [
    sendMessage,
    refusals,
    accountReads,
    errors,
    trialRefusals,
    fullRefusals,
    trialSend,
    fullSend,
  ],
  emulator: () =>
    emulatorTarget(twilio, {}, (emulator) =>
      seedTwilio(emulator.store, {
        accounts: [
          { sid: ACCOUNTS.test.sid, authToken: ACCOUNTS.test.token },
          {
            sid: ACCOUNTS.trial.sid,
            authToken: ACCOUNTS.trial.token,
            type: "Trial",
            verified: [EMULATOR_NUMBERS.trial.to],
          },
          { sid: ACCOUNTS.full.sid, authToken: ACCOUNTS.full.token },
        ],
        numbers: [
          { number: VALID_FROM, account: ACCOUNTS.test.sid },
          { number: EMULATOR_NUMBERS.trial.from, account: ACCOUNTS.trial.sid },
          { number: EMULATOR_NUMBERS.full.from, account: ACCOUNTS.full.sid },
        ],
      }),
    ),
  live(env) {
    const found = requiredCredentials(this, env)
    const login = found === undefined ? undefined : loginOf(found)

    return login === undefined ? undefined : liveTarget({ ...login, ...sendsOf(found ?? {}) })
  },
}

/** Who to call as: an API key and its secret when both are set, else the Auth Token. */
function loginOf(found: Readonly<Record<string, string>>) {
  const sid = found[SID]
  const byKey = found[KEY_SID] !== undefined && found[KEY_SECRET] !== undefined
  const user = byKey ? found[KEY_SID] : sid
  const password = byKey ? found[KEY_SECRET] : found[TOKEN]

  return sid === undefined || user === undefined || password === undefined
    ? undefined
    : { sid, user, password }
}

/** The numbers and opt-in for a real send, as they are set. */
function sendsOf(found: Readonly<Record<string, string>>): Record<string, string> {
  const named: ReadonlyArray<readonly [string, string]> = [
    ["from", FROM],
    ["to", TO],
    ["sendOnTrial", SEND_ON_TRIAL],
  ]

  return Object.fromEntries(
    named.flatMap(([key, variable]) => {
      const value = found[variable]

      return value === undefined ? [] : [[key, value]]
    }),
  )
}
