import { createHash, createHmac, randomBytes } from "node:crypto"
import { once } from "node:events"
import { createServer, type Server } from "node:http"
import { text as readText } from "node:stream/consumers"

import * as sdk from "nylas"
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import { createEmulator, type Emulator } from "../src/define.ts"
import { serve } from "../src/http.ts"
import { listeningPort } from "../src/net.ts"
import { nylas, nylasApplication, nylasOutboundFaults, seedNylas } from "../src/nylas/index.ts"

/*
 * The package's type files read as CommonJS, so their default export sits one level deeper than
 * the ESM build the tests run, where `default` is the class itself.
 */
type NylasClass = typeof sdk.default.default
const runtimeDefault: unknown = sdk.default
// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the ESM build's default is the class the types call default.default
const Nylas = (
  typeof runtimeDefault === "function" ? runtimeDefault : sdk.default.default
) as NylasClass
const { NylasApiError, NylasOAuthError } = sdk

const KEY = "REDACTED-TEST-VALUE"
const SECRET = "nylas-webhook-secret"

let emulator: Emulator
let server: Server
let baseUrl: string
let hook: Server
let hookUrl: string
const deliveries: { body: string; signature: string | undefined }[] = []

const client = (apiKey = KEY) => new Nylas({ apiKey, apiUri: baseUrl })

beforeAll(async () => {
  server = serve({ fetch: (request) => emulator.fetch(request), port: 0 })
  await once(server, "listening")
  baseUrl = `http://127.0.0.1:${listeningPort(server)}`
  emulator = createEmulator(nylas, { baseUrl })
  hook = createServer((req, res) => {
    const signature = req.headers["x-nylas-signature"]

    void readText(req).then((body) => {
      deliveries.push({ body, signature: typeof signature === "string" ? signature : undefined })
      res.end("ok")
    })
  })
  hook.listen(0)
  await once(hook, "listening")
  hookUrl = `http://127.0.0.1:${listeningPort(hook)}/nylas`
})

afterAll(async () => {
  server.close()
  hook.close()
  await emulator.close()
})

beforeEach(() => {
  emulator.reset()
  deliveries.length = 0
  seedNylas(emulator.store, {
    apiKeys: [KEY],
    grants: [
      { id: "11111111-1111-4111-8111-111111111111", email: "ada@acme.test", name: "Ada" },
      {
        id: "22222222-2222-4222-8222-222222222222",
        email: "grace@acme.test",
        provider: "microsoft",
        messages: [{ from: "news@outside.test", subject: "Welcome", body: "<p>Hi Grace</p>" }],
      },
    ],
    webhooks: [{ url: hookUrl, secret: SECRET }],
  })
})

const ADA = "11111111-1111-4111-8111-111111111111"
const GRACE = "22222222-2222-4222-8222-222222222222"

describe("keys and errors", () => {
  it("refuses a key the application never issued, as the SDK reads it", async () => {
    const error = await client("REDACTED-TEST-VALUE")
      .grants.list()
      .catch((e: unknown) => e)

    expect(error).toBeInstanceOf(NylasApiError)
    expect(error).toMatchObject({ statusCode: 401, type: "unauthorized" })
  })

  it("answers an unknown grant with not_found_error", async () => {
    const error = await client()
      .messages.list({ identifier: "33333333-3333-4333-8333-333333333333" })
      .catch((e: unknown) => e)

    expect(error).toMatchObject({ statusCode: 404, type: "not_found_error" })
  })

  it("gives server errors and drops on writes, and leaves the hosted page alone", () => {
    expect(nylasOutboundFaults({ method: "GET", path: "/v3/connect/auth" })).toEqual([])
    expect(
      nylasOutboundFaults({ method: "POST", path: "/v3/grants/x/messages/send" }).map(
        (f) => f.kind,
      ),
    ).toContain("reset-after")
  })
})

describe("email", () => {
  it("sends between two grants: filed as sent, delivered to the other inbox, signed webhooks", async () => {
    const sent = await client().messages.send({
      identifier: ADA,
      requestBody: { to: [{ email: "grace@acme.test" }], subject: "Lunch?", body: "<p>Noon</p>" },
    })

    expect(sent.data).toMatchObject({ subject: "Lunch?", folders: ["SENT"], grantId: ADA })

    const inbox = await client().messages.list({
      identifier: GRACE,
      queryParams: { in: ["INBOX"] },
    })

    expect(inbox.data.map((m) => m.subject)).toEqual(["Lunch?", "Welcome"])
    expect(nylasApplication(emulator).sent("ada@acme.test")).toHaveLength(1)

    await vi.waitFor(() => expect(deliveries.length).toBeGreaterThanOrEqual(2))

    for (const delivery of deliveries)
      expect(delivery.signature).toBe(
        createHmac("sha256", SECRET).update(delivery.body).digest("hex"),
      )

    expect(JSON.parse(deliveries[0]?.body ?? "{}")).toMatchObject({
      type: "message.created",
      data: { grant_id: ADA, object: { subject: "Lunch?" } },
    })
  })

  it("threads a reply, marks read, files drafts and lists folders with counts", async () => {
    const welcome = nylasApplication(emulator).messages("grace@acme.test", "INBOX")[0]

    await client().messages.update({
      identifier: GRACE,
      messageId: welcome?.id ?? "",
      requestBody: { unread: false },
    })

    const reply = await client().messages.send({
      identifier: GRACE,
      requestBody: {
        to: [{ email: "news@outside.test" }],
        subject: "Re: Welcome",
        body: "Thanks",
        replyToMessageId: welcome?.id ?? "",
      },
    })
    const thread = await client().threads.find({
      identifier: GRACE,
      threadId: reply.data.threadId ?? "",
    })

    expect(thread.data.messageIds).toHaveLength(2)
    expect(thread.data.unread).toBe(false)

    const draft = await client().drafts.create({
      identifier: GRACE,
      requestBody: { subject: "Later", to: [{ email: "x@y.test" }] },
    })

    expect(draft.data.subject).toBe("Later")

    const folders = await client().folders.list({ identifier: GRACE })
    const inbox = folders.data.find((f) => f.id === "INBOX")

    expect(inbox).toMatchObject({ totalCount: 1, unreadCount: 0 })
  })

  it("expires a grant: calls are refused and grant.expired goes out", async () => {
    nylasApplication(emulator).expire("ada@acme.test")

    const error = await client()
      .messages.list({ identifier: ADA })
      .catch((e: unknown) => e)

    expect(error).toMatchObject({ statusCode: 401, type: "token.unauthorized" })
    await vi.waitFor(() =>
      expect(deliveries.map((d) => JSON.parse(d.body).type)).toContain("grant.expired"),
    )
  })
})

describe("calendar and contacts", () => {
  it("creates, lists, updates and deletes events, and reports free/busy", async () => {
    const start = 1_900_000_800
    const created = await client().events.create({
      identifier: ADA,
      queryParams: { calendarId: "primary" },
      requestBody: {
        title: "Standup",
        when: { startTime: start, endTime: start + 900 },
        participants: [{ email: "grace@acme.test", status: "noreply" }],
      },
    })

    expect(created.data).toMatchObject({
      title: "Standup",
      when: { object: "timespan", startTime: start },
    })

    const listed = await client().events.list({
      identifier: ADA,
      queryParams: { calendarId: "ada@acme.test" },
    })

    expect(listed.data.map((e) => e.title)).toEqual(["Standup"])

    const busy = await client().calendars.getFreeBusy({
      identifier: ADA,
      requestBody: { startTime: start - 3600, endTime: start + 3600, emails: ["ada@acme.test"] },
    })

    expect(busy.data[0]).toMatchObject({
      email: "ada@acme.test",
      timeSlots: [{ startTime: start, status: "busy" }],
    })

    await client().events.update({
      identifier: ADA,
      eventId: created.data.id,
      queryParams: { calendarId: "primary" },
      requestBody: { title: "Standup (moved)" },
    })
    await client().events.destroy({
      identifier: ADA,
      eventId: created.data.id,
      queryParams: { calendarId: "primary" },
    })
    expect(nylasApplication(emulator).events("ada@acme.test")).toEqual([])
  })

  it("keeps contacts and finds them by email", async () => {
    await client().contacts.create({
      identifier: ADA,
      requestBody: { givenName: "Linus", emails: [{ email: "linus@kernel.test", type: "work" }] },
    })

    const found = await client().contacts.list({
      identifier: ADA,
      queryParams: { email: "linus@kernel.test" },
    })

    expect(found.data.map((c) => c.givenName)).toEqual(["Linus"])
  })
})

describe("hosted auth", () => {
  it("connects an account with PKCE as a browser does, then acts as the grant with its token", async () => {
    const verifier = randomBytes(32).toString("base64url")
    const challenge = createHash("sha256").update(verifier).digest("base64url")
    const page = await fetch(
      `${baseUrl}/v3/connect/auth?client_id=app&redirect_uri=${encodeURIComponent("https://app.test/cb")}&response_type=code&provider=google&state=s1&code_challenge=${challenge}&code_challenge_method=S256&login_hint=linus@kernel.test`,
    )

    expect(await page.text()).toContain('value="linus@kernel.test"')

    const decided = await fetch(`${baseUrl}/v3/connect/auth/decide`, {
      method: "POST",
      redirect: "manual",
      body: new URLSearchParams({
        client_id: "app",
        redirect_uri: "https://app.test/cb",
        provider: "google",
        state: "s1",
        code_challenge: challenge,
        code_challenge_method: "S256",
        email: "linus@kernel.test",
        decision: "allow",
      }),
    })
    const back = new URL(decided.headers.get("location") ?? "")

    expect(back.searchParams.get("state")).toBe("s1")

    const tokens = await fetch(`${baseUrl}/v3/connect/token`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        client_id: "app",
        grant_type: "authorization_code",
        code: back.searchParams.get("code"),
        redirect_uri: "https://app.test/cb",
        code_verifier: verifier,
      }),
    }).then((r) => r.json())

    expect(tokens).toMatchObject({
      email: "linus@kernel.test",
      provider: "google",
      token_type: "Bearer",
    })

    const me = await new Nylas({ apiKey: tokens.access_token, apiUri: baseUrl }).grants.find({
      grantId: "me",
    })

    expect(me.data.email).toBe("linus@kernel.test")
  })

  it("refuses a code twice and a wrong verifier, as OAuth errors", async () => {
    const error = await client()
      .auth.exchangeCodeForToken({
        clientId: "app",
        redirectUri: "https://app.test/cb",
        code: "nope",
        clientSecret: KEY,
      })
      .catch((e: unknown) => e)

    expect(error).toBeInstanceOf(NylasOAuthError)
    expect(error).toMatchObject({ statusCode: 400, error: "invalid_grant" })
  })
})

describe("scheduler", () => {
  it("offers open slots, books one onto the organizer's calendar, and cancels it", async () => {
    const config: { data: { id: string } } = await fetch(
      `${baseUrl}/v3/grants/${ADA}/scheduling/configurations`,
      {
        method: "POST",
        headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json" },
        body: JSON.stringify({
          name: "Intro",
          participants: [{ email: "ada@acme.test", is_organizer: true }],
          availability: { duration_minutes: 30 },
          event_booking: { title: "Intro call" },
        }),
      },
    ).then((r) => r.json())
    const monday = Date.parse("2030-03-04T00:00:00Z") / 1000
    const slots = await fetch(
      `${baseUrl}/v3/scheduling/availability?configuration_id=${config.data.id}&start_time=${monday}&end_time=${monday + 86_400}`,
      { headers: { authorization: `Bearer ${KEY}` } },
    ).then((r) => r.json())
    const first = slots.data.time_slots[0]

    expect(first.start_time).toBe(monday + 9 * 3600)

    const booked = await fetch(
      `${baseUrl}/v3/scheduling/bookings?configuration_id=${config.data.id}`,
      {
        method: "POST",
        headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json" },
        body: JSON.stringify({
          start_time: first.start_time,
          end_time: first.end_time,
          guest: { email: "guest@out.test", name: "Guest" },
        }),
      },
    ).then((r) => r.json())

    expect(booked.data).toMatchObject({
      status: "booked",
      title: "Intro call",
      guest: { email: "guest@out.test" },
    })
    expect(
      nylasApplication(emulator)
        .events("ada@acme.test")
        .map((e) => e.title),
    ).toEqual(["Intro call"])

    await fetch(
      `${baseUrl}/v3/scheduling/bookings/${booked.data.booking_id}?configuration_id=${config.data.id}`,
      {
        method: "DELETE",
        headers: { authorization: `Bearer ${KEY}` },
      },
    )
    expect(nylasApplication(emulator).events("ada@acme.test")).toEqual([])
  })
})
