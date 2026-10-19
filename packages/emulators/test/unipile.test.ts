import { once } from "node:events"
import { createServer, type Server } from "node:http"
import { text as readText } from "node:stream/consumers"

import { UnipileClient } from "unipile-node-sdk"
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import { createEmulator, type Emulator } from "../src/define.ts"
import { serve } from "../src/http.ts"
import { listeningPort } from "../src/net.ts"
import {
  seedUnipile,
  unipile,
  unipileOutboundFaults,
  unipileWorkspace,
} from "../src/unipile/index.ts"

const TOKEN = "unipile-access-token"

let emulator: Emulator
let server: Server
let baseUrl: string
let hook: Server
let hookUrl: string
const deliveries: { body: string; headers: Record<string, string> }[] = []

/** The SDK, checking every answer against its own response schemas. */
const client = (token = TOKEN) =>
  new UnipileClient(baseUrl, token, {
    validateRequestPayload: true,
    validateRequestPayloadLevel: "error",
  })

beforeAll(async () => {
  server = serve({ fetch: (request) => emulator.fetch(request), port: 0 })
  await once(server, "listening")
  baseUrl = `http://127.0.0.1:${listeningPort(server)}`
  emulator = createEmulator(unipile, { baseUrl })
  hook = createServer((req, res) => {
    const headers = Object.fromEntries(
      Object.entries(req.headers).flatMap(([k, v]) => (typeof v === "string" ? [[k, v]] : [])),
    )

    void readText(req).then((body) => {
      deliveries.push({ body, headers })
      res.end("ok")
    })
  })
  hook.listen(0)
  await once(hook, "listening")
  hookUrl = `http://127.0.0.1:${listeningPort(hook)}/unipile`
})

afterAll(async () => {
  server.close()
  hook.close()
  await emulator.close()
})

beforeEach(() => {
  emulator.reset()
  deliveries.length = 0
  seedUnipile(emulator.store, {
    tokens: [TOKEN],
    accounts: [
      { id: "acc_linkedin", type: "LINKEDIN", name: "Ada Lovelace", username: "ada" },
      { id: "acc_mail", type: "GOOGLE_OAUTH", name: "Ada", username: "ada@acme.test" },
    ],
    webhooks: [
      {
        source: "messaging",
        url: hookUrl,
        headers: [{ key: "Unipile-Auth", value: "shared-secret" }],
      },
      { source: "account_status", url: hookUrl },
      { source: "email", url: hookUrl },
    ],
  })
})

const bodies = () => deliveries.map((d) => JSON.parse(d.body))

describe("keys and errors", () => {
  it("refuses a missing or wrong token with Unipile's problem body", async () => {
    const error = await client("wrong")
      .account.getAll()
      .catch((e: unknown) => e)

    expect(error).toMatchObject({ body: { status: 401, type: "errors/invalid_credentials" } })
  })

  it("leaves hosted pages alone and faults sends fully", () => {
    expect(
      unipileOutboundFaults({ host: "account.unipile.com", method: "GET", path: "/abc" }),
    ).toEqual([])
    expect(
      unipileOutboundFaults({ method: "POST", path: "/api/v1/chats/c1/messages" }).map(
        (f) => f.kind,
      ),
    ).toContain("reset-after")
  })
})

describe("accounts and hosted auth", () => {
  it("lists accounts in the SDK's schema and reads the owner's profile", async () => {
    const accounts = await client().account.getAll()

    expect(accounts.items.map((a) => a.type)).toEqual(["LINKEDIN", "GOOGLE_OAUTH"])

    const me = await client().users.getOwnProfile("acc_linkedin")

    expect(me).toMatchObject({ provider: "LINKEDIN", public_identifier: "ada" })
  })

  it("connects an account through a hosted link, notifying the app and redirecting back", async () => {
    const link = await client().account.createHostedAuthLink({
      type: "create",
      providers: "*",
      api_url: baseUrl,
      expiresOn: "2099-01-01T00:00:00.000Z",
      notify_url: hookUrl,
      name: "user-42",
      success_redirect_url: "https://app.test/done",
    })
    const path = new URL(link.url).pathname

    expect(await fetch(`${baseUrl}${path}`).then((r) => r.text())).toContain("Connect your account")

    const done = await fetch(`${baseUrl}${path}/connect`, {
      method: "POST",
      redirect: "manual",
      body: new URLSearchParams({
        provider: "WHATSAPP",
        username: "+2348000000000",
        name: "Grace",
      }),
    })

    expect(done.headers.get("location")).toMatch(/^https:\/\/app\.test\/done\?account_id=/)
    await vi.waitFor(() =>
      expect(bodies()).toContainEqual(
        expect.objectContaining({ status: "CREATION_SUCCESS", name: "user-42" }),
      ),
    )
    expect(bodies()).toContainEqual({
      AccountStatus: expect.objectContaining({
        message: "CREATION_SUCCESS",
        account_type: "WHATSAPP",
      }),
    })
  })

  it("says when an account's session stops working", async () => {
    unipileWorkspace(emulator).disconnect("acc_linkedin")

    const account = await client().account.getOne("acc_linkedin")

    expect(account.sources[0]?.status).toBe("CREDENTIALS")
    await vi.waitFor(() =>
      expect(bodies()).toContainEqual({
        AccountStatus: {
          account_id: "acc_linkedin",
          account_type: "LINKEDIN",
          message: "CREDENTIALS",
        },
      }),
    )
  })
})

describe("messaging", () => {
  it("starts a chat, sends and lists messages in the SDK's schemas, and announces received ones with the subscription's headers", async () => {
    const started = await client().messaging.startNewChat({
      account_id: "acc_linkedin",
      attendees_ids: ["ACoAAgrace"],
      text: "Hello Grace",
    })

    expect(started.chat_id).toBeTruthy()

    const reply = unipileWorkspace(emulator).receive(
      "acc_linkedin",
      { providerId: "ACoAAgrace", name: "Grace" },
      "Hi Ada",
    )

    expect(reply.chat_id).toBe(started.chat_id)

    await client().messaging.sendMessage({ chat_id: started.chat_id ?? "", text: "How are you?" })

    const messages = await client().messaging.getAllMessagesFromChat({
      chat_id: started.chat_id ?? "",
    })

    expect(messages.items.map((m) => m.text)).toEqual(["How are you?", "Hi Ada", "Hello Grace"])

    const chats = await client().messaging.getAllChats({ account_id: "acc_linkedin" })

    expect(chats.items).toHaveLength(1)

    await vi.waitFor(() =>
      expect(bodies().filter((b) => b.event === "message_received")).toHaveLength(3),
    )

    const received = deliveries.find((d) => JSON.parse(d.body).message === "Hi Ada")

    expect(received?.headers["unipile-auth"]).toBe("shared-secret")
    expect(JSON.parse(received?.body ?? "{}")).toMatchObject({
      sender: { attendee_name: "Grace" },
      chat_id: started.chat_id,
    })
  })
})

describe("email and webhooks", () => {
  it("sends and lists mail, and announces mail received", async () => {
    const sent = await client().email.send({
      account_id: "acc_mail",
      to: [{ identifier: "grace@acme.test", display_name: "Grace" }],
      subject: "Hello",
      body: "<p>Hi</p>",
    })

    expect(sent).toMatchObject({ object: "EmailSent" })

    unipileWorkspace(emulator).receiveEmail("acc_mail", {
      from: "grace@acme.test",
      subject: "Re: Hello",
    })

    const list = await client().email.getAll({ account_id: "acc_mail" })

    expect(list.items.map((e) => ("subject" in e ? e.subject : ""))).toEqual(["Re: Hello", "Hello"])
    await vi.waitFor(() =>
      expect(bodies().map((b) => b.event)).toEqual(
        expect.arrayContaining(["mail_sent", "mail_received"]),
      ),
    )
  })

  it("creates, lists and deletes webhooks in the SDK's schemas", async () => {
    const created = await client().webhook.create({
      request_url: hookUrl,
      source: "messaging",
      name: "app",
    })
    const listed = await client().webhook.getAll()

    expect(listed.items.map((w) => w.id)).toContain(created.webhook_id)

    await client().webhook.delete(created.webhook_id)
    expect((await client().webhook.getAll()).items.map((w) => w.id)).not.toContain(
      created.webhook_id,
    )
  })
})
