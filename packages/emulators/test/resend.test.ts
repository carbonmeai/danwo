import { once } from "node:events"
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http"

import { Resend, type WebhookEventPayload } from "resend"
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import { createEmulator, type Emulator } from "../src/define.ts"
import { serve } from "../src/http.ts"
import { listeningPort } from "../src/net.ts"
import { resend, resendInbox, resendOutboundFaults, seedResend } from "../src/resend/index.ts"

const SECRET = "REDACTED-TEST-VALUE"

let emulator: Emulator
let server: Server
let baseUrl: string

function client(key = "re_test_emulated"): Resend {
  return new Resend(key, { baseUrl })
}

beforeAll(async () => {
  server = serve({ fetch: (request) => emulator.fetch(request), port: 0 })
  await once(server, "listening")
  baseUrl = `http://127.0.0.1:${listeningPort(server)}`
  emulator = createEmulator(resend, { baseUrl })
})

afterAll(async () => {
  server.close()
  await emulator.close()
})

beforeEach(() => {
  emulator.reset()
})

describe("API keys", () => {
  it("refuses a request without a key", async () => {
    const res = await fetch(`${baseUrl}/emails`)

    expect(res.status).toBe(401)
    expect(await res.json()).toMatchObject({ statusCode: 401, name: "missing_api_key" })
  })

  it("refuses a malformed key", async () => {
    const { data, error } = await client("sk_test_not_resend").emails.list()

    expect(data).toBeNull()
    expect(error).toMatchObject({ statusCode: 403, name: "invalid_api_key" })
  })
})

describe("emails", () => {
  it("sends, retrieves and lists through the official client", async () => {
    const r = client()
    const sent = await r.emails.send({
      from: "QA <qa@danwo.test>",
      to: "user@example.com",
      subject: "Hello",
      html: "<p>Hi</p>",
      tags: [{ name: "kind", value: "welcome" }],
    })

    expect(sent.error).toBeNull()
    const id = sent.data?.id ?? ""

    expect(id).not.toBe("")

    const got = await r.emails.get(id)

    expect(got.data).toMatchObject({
      object: "email",
      id,
      from: "QA <qa@danwo.test>",
      to: ["user@example.com"],
      subject: "Hello",
      html: "<p>Hi</p>",
      last_event: "delivered",
    })

    await r.emails.send({
      from: "qa@danwo.test",
      to: "b@example.com",
      subject: "Second",
      text: "x",
    })
    const list = await r.emails.list()

    expect(list.data?.object).toBe("list")
    expect(list.data?.data.map((e) => e.subject)).toEqual(["Second", "Hello"])
  })

  it("returns not_found for a missing email", async () => {
    const { error } = await client().emails.get("00000000-0000-0000-0000-000000000000")

    expect(error).toMatchObject({ statusCode: 404, name: "not_found" })
  })

  it("refuses a send without the required fields", async () => {
    const res = await fetch(`${baseUrl}/emails`, {
      method: "POST",
      headers: { Authorization: "Bearer re_test", "Content-Type": "application/json" },
      body: JSON.stringify({ from: "qa@danwo.test" }),
    })

    expect(res.status).toBe(422)
  })

  it("sends a batch", async () => {
    const r = client()
    const { data, error } = await r.batch.send([
      { from: "qa@danwo.test", to: "a@example.com", subject: "One", text: "1" },
      { from: "qa@danwo.test", to: "b@example.com", subject: "Two", text: "2" },
    ])

    expect(error).toBeNull()
    expect(data?.data).toHaveLength(2)
    expect(resendInbox(emulator).list()).toHaveLength(2)
  })

  it("cancels a scheduled email, and only a scheduled one", async () => {
    const r = client()
    const scheduled = await r.emails.send({
      from: "qa@danwo.test",
      to: "a@example.com",
      subject: "Later",
      text: "later",
      scheduledAt: "2099-01-01T00:00:00.000Z",
    })
    const id = scheduled.data?.id ?? ""

    expect((await r.emails.get(id)).data?.last_event).toBe("scheduled")

    const canceled = await r.emails.cancel(id)

    expect(canceled.data).toMatchObject({ object: "email", id })
    expect((await r.emails.get(id)).data?.last_event).toBe("canceled")

    const again = await r.emails.cancel(id)

    expect(again.error).not.toBeNull()
  })
})

describe("idempotency keys", () => {
  it("replays the same request and refuses a different one", async () => {
    const r = client()
    const email = { from: "qa@danwo.test", to: "a@example.com", subject: "Once", text: "1" }
    const first = await r.emails.send(email, { idempotencyKey: "signup-42" })
    const second = await r.emails.send(email, { idempotencyKey: "signup-42" })

    expect(second.data?.id).toBe(first.data?.id)
    expect(resendInbox(emulator).list()).toHaveLength(1)

    const conflict = await r.emails.send(
      { ...email, subject: "Changed" },
      { idempotencyKey: "signup-42" },
    )

    expect(conflict.error).toMatchObject({ statusCode: 409, name: "invalid_idempotent_request" })
  })

  it("refuses a key that is too long", async () => {
    const { error } = await client().emails.send(
      { from: "qa@danwo.test", to: "a@example.com", subject: "x", text: "x" },
      { idempotencyKey: "k".repeat(257) },
    )

    expect(error).toMatchObject({ statusCode: 400, name: "invalid_idempotency_key" })
  })
})

describe("domains", () => {
  it("creates, lists, retrieves, verifies and removes a domain", async () => {
    const r = client()
    const created = await r.domains.create({ name: "mail.danwo.test", region: "eu-west-1" })

    expect(created.error).toBeNull()
    const id = created.data?.id ?? ""

    expect(created.data?.records.length).toBeGreaterThan(0)

    expect((await r.domains.list()).data?.data.map((d) => d.name)).toEqual(["mail.danwo.test"])
    expect((await r.domains.get(id)).data).toMatchObject({ name: "mail.danwo.test" })
    expect((await r.domains.verify(id)).data).toMatchObject({ object: "domain", id })
    expect((await r.domains.remove(id)).data).toMatchObject({ id, deleted: true })
    expect((await r.domains.get(id)).error).toMatchObject({ statusCode: 404 })
  })

  it("refuses an unknown region", async () => {
    const res = await fetch(`${baseUrl}/domains`, {
      method: "POST",
      headers: { Authorization: "Bearer re_test", "Content-Type": "application/json" },
      body: JSON.stringify({ name: "x.test", region: "mars-1" }),
    })

    expect(res.status).toBe(422)
    expect(await res.json()).toMatchObject({ name: "invalid_region" })
  })
})

describe("API key management", () => {
  it("creates, lists and removes a key", async () => {
    const r = client()
    const created = await r.apiKeys.create({ name: "ci" })

    expect(created.data?.token).toMatch(/^re_/)
    const id = created.data?.id ?? ""

    expect((await r.apiKeys.list()).data?.data.map((k) => k.name)).toEqual(["ci"])
    await r.apiKeys.remove(id)
    expect((await r.apiKeys.list()).data?.data).toEqual([])
  })
})

describe("inbox", () => {
  it("lists by recipient, newest first, and reads codes and links", async () => {
    const r = client()

    await r.emails.send({
      from: "qa@danwo.test",
      to: "Someone@Example.com",
      subject: "Old",
      text: "Your code is 111111",
    })
    await r.emails.send({
      from: "qa@danwo.test",
      to: "other@example.com",
      cc: "someone@example.com",
      subject: "Sign in",
      html: '<p>Your code is <b>482913</b>.</p><a href="https://app.test/verify?t=1&amp;u=2">Verify</a>',
      text: "Code 482913. Or open https://app.test/verify?t=1&u=2 and https://app.test/help",
    })
    await r.emails.send({
      from: "qa@danwo.test",
      to: "x@example.com",
      subject: "Unrelated",
      text: "",
    })

    const inbox = resendInbox(emulator)

    expect(inbox.list("someone@example.com").map((e) => e.subject)).toEqual(["Sign in", "Old"])
    const latest = inbox.latest("someone@example.com")

    expect(latest?.code()).toBe("482913")
    expect(latest?.code(4)).toBeUndefined()
    expect(latest?.links()).toEqual(["https://app.test/verify?t=1&u=2", "https://app.test/help"])
    expect(inbox.latest("nobody@example.com")).toBeUndefined()
  })

  it("waits for an email that arrives later", async () => {
    const inbox = resendInbox(emulator)
    const waiting = inbox.waitFor("late@example.com", { timeoutMs: 2_000 })

    await client().emails.send({
      from: "qa@danwo.test",
      to: "late@example.com",
      subject: "Here",
      text: "",
    })
    expect((await waiting).subject).toBe("Here")
  })
})

/** Stands in for an app's webhook route: verifies each delivery with the official client. */
class Receiver {
  readonly received: WebhookEventPayload[] = []
  readonly ids: string[] = []
  server: Server = createServer((req, res) => void this.handle(req, res))
  url = ""

  async start(): Promise<void> {
    this.server.listen(0, "127.0.0.1")
    await once(this.server, "listening")
    this.url = `http://127.0.0.1:${listeningPort(this.server)}/webhooks/resend`
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const chunks: Buffer[] = []

    for await (const chunk of req) chunks.push(chunk as Buffer)
    const header = (name: string) => String(req.headers[name] ?? "")

    try {
      const event = new Resend("re_receiver").webhooks.verify({
        payload: Buffer.concat(chunks).toString("utf8"),
        headers: {
          id: header("webhook-id"),
          timestamp: header("webhook-timestamp"),
          signature: header("webhook-signature"),
        },
        webhookSecret: SECRET,
      })

      this.received.push(event)
      this.ids.push(header("webhook-id"))
      res.statusCode = 200
    } catch {
      res.statusCode = 400
    }

    res.end()
  }
}

describe("webhooks", () => {
  let receiver: Receiver
  let hooked: Emulator

  beforeEach(async () => {
    receiver = new Receiver()
    await receiver.start()
    // The verifier allows five minutes of skew from real time, so this emulator uses the system clock.
    hooked = createEmulator(resend, { baseUrl })
  })

  afterEach(async () => {
    await hooked.close()
    receiver.server.close()
  })

  it("delivers email events signed the way the official verifier accepts", async () => {
    seedResend(hooked.store, {
      webhooks: [
        { endpoint: receiver.url, events: ["email.sent", "email.delivered"], secret: SECRET },
      ],
    })
    const sent = await hooked.fetch(
      new Request(`${baseUrl}/emails`, {
        method: "POST",
        headers: { Authorization: "Bearer re_test", "Content-Type": "application/json" },
        body: JSON.stringify({
          from: "qa@danwo.test",
          to: "a@example.com",
          subject: "Hi",
          text: "",
        }),
      }),
    )
    const { id } = (await sent.json()) as { id: string }

    await vi.waitFor(() => expect(receiver.received).toHaveLength(2))

    expect(receiver.received.map((e) => e.type)).toEqual(["email.sent", "email.delivered"])
    expect(receiver.received[0]).toMatchObject({ data: { email_id: id, to: ["a@example.com"] } })
    expect(new Set(receiver.ids).size).toBe(2)
    expect(receiver.ids.every((value) => value.startsWith("msg_"))).toBe(true)
  })

  it("is rejected by the verifier under the wrong secret", async () => {
    seedResend(hooked.store, {
      webhooks: [{ endpoint: receiver.url, events: ["domain.created"], secret: "REDACTED-TEST-VALUE" }],
    })
    await hooked.fetch(
      new Request(`${baseUrl}/domains`, {
        method: "POST",
        headers: { Authorization: "Bearer re_test", "Content-Type": "application/json" },
        body: JSON.stringify({ name: "x.test" }),
      }),
    )
    await vi.waitFor(() => expect(hooked.webhooks?.attempts()).toHaveLength(1))
    expect(hooked.webhooks?.attempts()[0]).toMatchObject({ status: 400, delivered: false })
    expect(receiver.received).toEqual([])
  })
})

describe("outbound faults", () => {
  it("faults only the calls that send", () => {
    const send = resendOutboundFaults({ method: "POST", path: "/emails" })

    expect(send.map((f) => ("status" in f ? f.status : f.kind))).toEqual([
      429,
      500,
      "delay",
      "reset",
      "reset-after",
    ])
    expect(resendOutboundFaults({ method: "POST", path: "/emails/batch" })).toEqual(send)
    expect(resendOutboundFaults({ method: "GET", path: "/emails" })).toEqual([])
    expect(resendOutboundFaults({ method: "POST", path: "/domains" })).toEqual([])
  })

  it("gives the official client Resend's own errors and rate limit headers", async () => {
    const [rateLimited, failed] = resendOutboundFaults({ method: "POST", path: "/emails" })
    let fault: { status: number; headers?: Record<string, string>; body: string } = rateLimited
    const faulty = createServer((_req, res) => {
      res.writeHead(fault.status, { "content-type": "application/json", ...fault.headers })
      res.end(fault.body)
    })

    faulty.listen(0, "127.0.0.1")
    await once(faulty, "listening")

    try {
      const r = new Resend("re_test_emulated", {
        baseUrl: `http://127.0.0.1:${listeningPort(faulty)}`,
      })
      const send = () =>
        r.emails.send({ from: "qa@danwo.test", to: "user@example.com", subject: "Code", text: "1" })
      const limited = await send()

      expect(limited.data).toBeNull()
      expect(limited.error).toMatchObject({ statusCode: 429, name: "rate_limit_exceeded" })
      expect(limited.headers).toMatchObject({ "retry-after": "1", "ratelimit-remaining": "0" })

      fault = failed
      expect((await send()).error).toMatchObject({ statusCode: 500, name: "application_error" })
    } finally {
      faulty.close()
    }
  })
})
