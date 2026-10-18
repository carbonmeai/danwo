import twilioSdk from "twilio"
import { beforeEach, describe, expect, it } from "vitest"

import { createEmulator, type Emulator } from "../src/define.ts"
import { ManualClock } from "../src/time.ts"
import {
  seedTwilio,
  twilio,
  twilioInbox,
  twilioOutboundFaults,
  twilioPhone,
} from "../src/twilio/index.ts"
import { ACCOUNT, APP_NUMBER, TOKEN, twilioClient } from "./twilio-client.ts"

const PERSON = "+14155550123"
const UNREACHABLE = "+14155550199"
const STATUS_URL = "http://app.test/twilio/status"
const SMS_URL = "http://app.test/twilio/sms"

/** One webhook the emulator POSTed to the app. */
interface Posted {
  readonly url: string
  readonly signature: string
  readonly form: URLSearchParams
}

let clock: ManualClock
let emulator: Emulator
let posted: Posted[]
/** What the app answers to an incoming message. */
let reply: string

beforeEach(() => {
  clock = new ManualClock(new Date("2026-10-18T08:00:00Z"))
  posted = []
  reply = "<Response/>"
  emulator = createEmulator(twilio, {
    clock: clock.clock,
    timer: clock.timer,
    fetch: async (url, init) => {
      const request = new Request(url, init)

      posted.push({
        url: request.url,
        signature: request.headers.get("x-twilio-signature") ?? "",
        form: new URLSearchParams(await request.text()),
      })

      return new Response(reply, { headers: { "content-type": "text/xml" } })
    },
  })
  seedTwilio(emulator.store, {
    accounts: [{ sid: ACCOUNT, authToken: TOKEN }],
    apiKeys: [{ sid: "REDACTED-TEST-VALUE", secret: "key-secret" }],
    numbers: [{ number: APP_NUMBER, smsUrl: SMS_URL }],
    verifyServices: [{ friendlyName: "Acme", sid: "REDACTED-TEST-VALUE" }],
    unreachable: [{ number: UNREACHABLE }],
  })
})

/** Moves the clock on and waits for every webhook it set off. */
async function pass(ms: number): Promise<void> {
  clock.advance(ms)
  await emulator.webhooks?.idle()
}

/** Whether a POST carries Twilio's signature for the account's auth token. */
function signedByTwilio(post: Posted): boolean {
  return twilioSdk.validateRequest(TOKEN, post.signature, post.url, Object.fromEntries(post.form))
}

/** The Twilio error code a call failed with, or undefined when it succeeded. */
function errorOf(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => undefined,
    (error: unknown) => (error instanceof Error && "code" in error ? error.code : error),
  )
}

describe("Twilio messages", () => {
  it("sends a message, moves it to delivered on the clock and posts signed status callbacks", async () => {
    const client = twilioClient(emulator)
    const sent = await client.messages.create({
      from: APP_NUMBER,
      to: PERSON,
      body: "Your table is ready",
      statusCallback: STATUS_URL,
    })

    expect(sent.sid).toMatch(/^SM[0-9a-f]{32}$/)
    expect(sent.status).toBe("queued")
    expect(sent.dateCreated.toISOString()).toBe("2026-10-18T08:00:00.000Z")

    await pass(2000)

    expect((await client.messages(sent.sid).fetch()).status).toBe("delivered")
    expect(posted.map((post) => post.form.get("MessageStatus"))).toEqual(["sent", "delivered"])
    expect(posted.every((post) => post.url === STATUS_URL && signedByTwilio(post))).toBe(true)
    expect(posted[0]?.form.get("MessageSid")).toBe(sent.sid)
  })

  it("ends a message to an unreachable phone undelivered with Twilio's error code", async () => {
    const client = twilioClient(emulator)
    const sent = await client.messages.create({
      from: APP_NUMBER,
      to: UNREACHABLE,
      body: "hi",
      statusCallback: STATUS_URL,
    })

    await pass(2000)

    const fetched = await client.messages(sent.sid).fetch()

    expect([fetched.status, fetched.errorCode]).toEqual(["undelivered", 30003])
    expect(posted.at(-1)?.form.get("ErrorCode")).toBe("30003")
  })

  it("lists messages newest first, page by page", async () => {
    const client = twilioClient(emulator)

    for (const body of ["one", "two", "three"])
      await client.messages.create({ from: APP_NUMBER, to: PERSON, body })

    const listed = await client.messages.list({ to: PERSON, pageSize: 2 })

    expect(listed.map((message) => message.body)).toEqual(["three", "two", "one"])
  })

  it("refuses sends the way Twilio does", async () => {
    const client = twilioClient(emulator)

    expect(await errorOf(client.messages.create({ from: APP_NUMBER, to: "555", body: "x" }))).toBe(
      21211,
    )
    expect(
      await errorOf(client.messages.create({ from: "+15550000000", to: PERSON, body: "x" })),
    ).toBe(21606)
    expect(await errorOf(client.messages.create({ from: APP_NUMBER, to: PERSON, body: "" }))).toBe(
      21602,
    )
    expect(await errorOf(twilioClient(emulator, ACCOUNT, "wrong").messages.list())).toBe(20003)
    expect(await errorOf(client.messages("SM404").fetch())).toBe(20404)
  })

  it("accepts an API key and secret as the account", async () => {
    const client = twilioClient(emulator, "REDACTED-TEST-VALUE", "key-secret")

    expect(
      (await client.messages.create({ from: APP_NUMBER, to: PERSON, body: "k" })).accountSid,
    ).toBe(ACCOUNT)
  })
})

describe("incoming messages", () => {
  it("posts a text to the number's SMS URL, signed, and sends the TwiML reply back", async () => {
    reply = "<?xml version='1.0'?><Response><Message>You are subscribed</Message></Response>"
    twilioPhone(emulator).send(PERSON, APP_NUMBER, "START")
    await pass(0)

    const incoming = posted[0]

    expect(incoming?.url).toBe(SMS_URL)
    expect(incoming && signedByTwilio(incoming)).toBe(true)
    expect([incoming?.form.get("From"), incoming?.form.get("Body")]).toEqual([PERSON, "START"])
    expect(twilioInbox(emulator).latest(PERSON)?.body).toBe("You are subscribed")
  })

  it("a forged copy does not verify", async () => {
    emulator.webhooks?.setFault(() => ({ kind: "forged" }))
    twilioPhone(emulator).send(PERSON, APP_NUMBER, "STOP")
    await pass(0)

    expect(posted.map(signedByTwilio).toSorted((a, b) => Number(a) - Number(b))).toEqual([
      false,
      true,
    ])
  })
})

describe("Twilio Verify", () => {
  const SERVICE = "REDACTED-TEST-VALUE"

  it("texts a code, refuses a wrong one and approves the right one", async () => {
    const verify = twilioClient(emulator).verify.v2.services(SERVICE)
    const started = await verify.verifications.create({ to: PERSON, channel: "sms" })
    const code = twilioInbox(emulator).latest(PERSON)?.code() ?? ""

    expect(started.status).toBe("pending")
    expect(code).toMatch(/^\d{6}$/)
    expect(twilioInbox(emulator).latest(PERSON)?.body).toContain("Your Acme verification code is")
    expect((await verify.verificationChecks.create({ to: PERSON, code: "000000" })).status).toBe(
      "pending",
    )

    const approved = await verify.verificationChecks.create({ to: PERSON, code })

    expect([approved.status, approved.valid]).toEqual(["approved", true])
    await expect(verify.verificationChecks.create({ to: PERSON, code })).rejects.toMatchObject({
      code: 20404,
    })
  })

  it("stops checking after five wrong codes", async () => {
    const verify = twilioClient(emulator).verify.v2.services(SERVICE)

    await verify.verifications.create({ to: PERSON, channel: "sms" })
    for (let i = 0; i < 5; i++) await verify.verificationChecks.create({ to: PERSON, code: "1" })

    await expect(verify.verificationChecks.create({ to: PERSON, code: "1" })).rejects.toMatchObject(
      { code: 60202 },
    )
  })

  it("lets a code expire after ten minutes", async () => {
    const verify = twilioClient(emulator).verify.v2.services(SERVICE)

    await verify.verifications.create({ to: PERSON, channel: "sms" })

    const code = twilioInbox(emulator).latest(PERSON)?.code() ?? ""

    clock.advance(11 * 60 * 1000)

    await expect(verify.verificationChecks.create({ to: PERSON, code })).rejects.toMatchObject({
      code: 20404,
    })
  })

  it("sends the same code again to a number with a pending verification", async () => {
    const verify = twilioClient(emulator).verify.v2.services(SERVICE)
    const first = await verify.verifications.create({ to: PERSON, channel: "sms" })
    const again = await verify.verifications.create({ to: PERSON, channel: "sms" })
    const codes = twilioInbox(emulator)
      .list(PERSON)
      .map((message) => message.code())

    expect(again.sid).toBe(first.sid)
    expect(new Set(codes).size).toBe(1)
    expect(codes).toHaveLength(2)
  })

  it("keeps Verify's texts out of the account's message list", async () => {
    const client = twilioClient(emulator)

    await client.verify.v2.services(SERVICE).verifications.create({ to: PERSON, channel: "sms" })

    expect(await client.messages.list()).toEqual([])
  })

  it("creates and fetches services", async () => {
    const client = twilioClient(emulator)
    const created = await client.verify.v2.services.create({ friendlyName: "Shop", codeLength: 4 })
    const fetched = await client.verify.v2.services(created.sid).fetch()

    expect([fetched.friendlyName, fetched.codeLength]).toEqual(["Shop", 4])
  })
})

describe("Twilio faults", () => {
  it("gives writes Twilio-shaped errors and a drop after Twilio acted", () => {
    const send = twilioOutboundFaults({
      method: "POST",
      path: "/2010-04-01/Accounts/AC/Messages.json",
    })
    const read = twilioOutboundFaults({
      method: "GET",
      path: "/2010-04-01/Accounts/AC/Messages.json",
    })

    expect(send.map((fault) => fault.kind)).toContain("reset-after")
    expect(read.map((fault) => fault.kind)).not.toContain("reset-after")
    expect(send[0]).toMatchObject({ status: 429, body: expect.stringContaining('"code":20429') })
  })
})
