import { once } from "node:events"

import { Novu } from "@novu/api"
import { workflow } from "@novu/framework"
import { Client, serve as serveBridge } from "@novu/framework/remix"
import { Novu as NovuInbox } from "@novu/js"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { WebSocket } from "ws"

import { serve } from "../src/http.ts"
import {
  connectNovuEmail,
  createEmulator,
  type Emulator,
  novu,
  novuProject,
  resend,
  resendInbox,
  seedNovu,
  serveSockets,
  type SocketServer,
} from "../src/index.ts"
import { listeningPort } from "../src/net.ts"

const KEY = "nv-secret"

let emulator: Emulator
let api: ReturnType<typeof serve>
let sockets: SocketServer
const servers: ReturnType<typeof serve>[] = []

const origin = () => `http://127.0.0.1:${listeningPort(api)}`
const sdk = () => new Novu({ secretKey: KEY, serverURL: origin() })

/** A code-first workflow served on a local bridge, as an app serves `@novu/framework`. */
async function bridge(): Promise<string> {
  const welcome = workflow(
    "welcome",
    async ({ step, payload }) => {
      const prefs = await step.custom("prefs", async () => ({ inbox: payload.inbox }), {
        outputSchema: {
          type: "object",
          properties: { inbox: { type: "boolean" } },
          required: ["inbox"],
          additionalProperties: false,
        } as const,
      })

      await step.email("mail", async () => ({
        subject: `Welcome ${payload.name}`,
        body: `<p>Hello ${payload.name}</p>`,
      }))
      await step.inApp(
        "bell",
        async () => ({
          subject: "Welcome",
          body: `Hi ${payload.name}`,
          data: { name: payload.name },
        }),
        {
          skip: () => !prefs.inbox,
        },
      )
    },
    {
      payloadSchema: {
        type: "object",
        properties: { name: { type: "string" }, inbox: { type: "boolean" } },
        required: ["name", "inbox"],
        additionalProperties: false,
      } as const,
    },
  )
  const assigned = workflow(
    "assigned",
    async ({ step, payload }) => {
      await step.inApp("bell", async () => ({ subject: "Assigned", body: payload.title }))
      await step.push("phone", async () => ({ subject: "Assigned", body: payload.title }))
      await step.email("mail", async () => ({
        subject: "Assigned",
        body: `<p>${payload.title}</p>`,
      }))
    },
    {
      payloadSchema: {
        type: "object",
        properties: { title: { type: "string" } },
        required: ["title"],
        additionalProperties: false,
      } as const,
    },
  )
  const handler = serveBridge({
    workflows: [welcome, assigned],
    client: new Client({ secretKey: KEY, strictAuthentication: true }),
  })
  const server = serve({ port: 0, fetch: (request) => handler({ request }) })

  await once(server, "listening")
  servers.push(server)

  return `http://127.0.0.1:${listeningPort(server)}/api/novu`
}

beforeEach(async () => {
  emulator = createEmulator(novu)
  seedNovu(emulator.store, { apiKey: KEY, applicationIdentifier: "app-ident" })
  api = serve({ fetch: emulator.fetch, port: 0 })
  await once(api, "listening")
  if (!emulator.connect) throw new Error("the Novu emulator answers sockets")
  sockets = await serveSockets(emulator.connect)
})

afterEach(async () => {
  await novuProject(emulator).idle()
  for (const server of servers.splice(0)) server.close()
  await sockets.close()
  await new Promise((resolve) => api.close(resolve))
  await emulator.close()
})

describe("novu server API", () => {
  it("creates, reads and patches subscribers, and manages topics", async () => {
    const client = sdk()
    const created = await client.subscribers.create({
      subscriberId: "u1",
      email: "ada@example.com",
      firstName: "Ada",
    })

    expect(created.result).toMatchObject({
      subscriberId: "u1",
      email: "ada@example.com",
      firstName: "Ada",
    })

    await client.subscribers.patch({ lastName: "Lovelace" }, "u1")

    expect((await client.subscribers.retrieve("u1")).result).toMatchObject({
      firstName: "Ada",
      lastName: "Lovelace",
    })

    await client.topics.create({ key: "team", name: "Team" })
    await client.topics.subscriptions.create({ subscriptions: ["u1"] }, "team")

    const listed = await client.topics.subscriptions.list({ topicKey: "team" })

    expect(listed.result.data.map((s) => s.subscriber.subscriberId)).toEqual(["u1"])
    await expect(
      new Novu({ secretKey: "wrong", serverURL: origin() }).subscribers.retrieve("u1"),
    ).rejects.toThrow("API Key not found")
  })

  it("runs a dashboard workflow into the subscriber's Inbox", async () => {
    seedNovu(emulator.store, {
      workflows: [
        {
          workflowId: "comment",
          steps: [
            {
              stepId: "bell",
              type: "in_app",
              subject: "New comment",
              body: "{{payload.author}} replied",
            },
          ],
        },
      ],
    })

    const triggered = await sdk().trigger({
      workflowId: "comment",
      to: "u2",
      payload: { author: "Grace" },
    })

    expect(triggered.result).toMatchObject({ acknowledged: true, status: "processed" })
    await novuProject(emulator).idle()
    expect(
      novuProject(emulator)
        .inbox("u2")
        .map((m) => m.content),
    ).toEqual(["Grace replied"])

    const listed = await sdk().subscribers.notifications.list({ subscriberId: "u2" })

    expect(listed.result.data[0]).toMatchObject({
      body: "Grace replied",
      subject: "New comment",
      isRead: false,
    })
  })
})

/** A trigger under one idempotency key, as a retry would send it again. */
function send(body: unknown): Promise<Response> {
  return fetch(`${origin()}/v1/events/trigger`, {
    method: "POST",
    headers: {
      authorization: `ApiKey ${KEY}`,
      "content-type": "application/json",
      "idempotency-key": "k-1",
    },
    body: JSON.stringify(body),
  })
}

describe("novu Inbox from the app's page", () => {
  it("answers a preflight and names the calling origin, so the browser's Inbox can start", async () => {
    const page = "http://localhost:3050"
    const preflight = await emulator.fetch(
      new Request("https://api.novu.co/v1/inbox/session", {
        method: "OPTIONS",
        headers: {
          origin: page,
          "access-control-request-headers": "content-type, novu-api-version",
        },
      }),
    )
    const server = await emulator.fetch(
      new Request("https://api.novu.co/v2/subscribers", {
        method: "OPTIONS",
        headers: { origin: page },
      }),
    )

    expect(preflight.status).toBe(204)
    expect(preflight.headers.get("access-control-allow-origin")).toBe(page)
    expect(preflight.headers.get("access-control-allow-headers")).toBe(
      "content-type, novu-api-version",
    )
    expect(server.headers.get("access-control-allow-origin")).toBeNull()
  })
})

describe("novu idempotency", () => {
  it("answers a retried trigger with the first answer, and runs the workflow once", async () => {
    seedNovu(emulator.store, {
      workflows: [{ workflowId: "once", steps: [{ stepId: "bell", type: "in_app", body: "hi" }] }],
    })

    const first = await send({ name: "once", to: "u9", payload: {} })
    const again = await send({ name: "once", to: "u9", payload: {} })

    expect(again.headers.get("idempotency-replayed")).toBe("true")
    expect(await again.json()).toEqual(await first.json())
    expect((await send({ name: "once", to: "u10", payload: {} })).status).toBe(422)
    await novuProject(emulator).idle()
    expect(novuProject(emulator).inbox("u9")).toHaveLength(1)
  })
})

describe("novu framework bridge", () => {
  it("executes each step through the app's bridge, skipping what it skips, and emails through Resend", async () => {
    const mail = createEmulator(resend)

    seedNovu(emulator.store, { bridgeUrl: await bridge() })
    connectNovuEmail(emulator, mail)
    await sdk().trigger({
      workflowId: "welcome",
      to: { subscriberId: "u3", email: "u3@example.com" },
      payload: { name: "Lin", inbox: false },
    })
    await novuProject(emulator).idle()

    const [run] = novuProject(emulator).executions({ workflowId: "welcome" })

    expect(run?.status).toBe("completed")
    expect(run?.steps.map((step) => `${step.stepId}:${step.status}`)).toEqual([
      "prefs:completed",
      "mail:completed",
      "bell:skipped",
    ])
    expect(novuProject(emulator).messages({ channel: "email" })[0]?.subject).toBe("Welcome Lin")
    expect(resendInbox(mail).latest("u3@example.com")?.subject).toBe("Welcome Lin")
    expect(novuProject(emulator).inbox("u3")).toEqual([])
  })

  it("passes each delivered step's result to the steps after it, as the bridge checks them", async () => {
    seedNovu(emulator.store, { bridgeUrl: await bridge() })
    await sdk().trigger({ workflowId: "assigned", to: "u6", payload: { title: "Review Q3 plan" } })
    await novuProject(emulator).idle()

    const [run] = novuProject(emulator).executions({ workflowId: "assigned" })

    expect(run?.error).toBeNull()
    expect(run?.status).toBe("completed")
    expect(run?.steps.map((step) => `${step.stepId}:${step.status}`)).toEqual([
      "bell:completed",
      "phone:completed",
      "mail:completed",
    ])
    expect(
      novuProject(emulator)
        .inbox("u6")
        .map((message) => message.subject),
    ).toEqual(["Assigned"])
  })

  it("fails the run when the bridge refuses a bad payload", async () => {
    seedNovu(emulator.store, { bridgeUrl: await bridge() })
    await sdk().trigger({ workflowId: "welcome", to: "u4", payload: { nope: true } })
    await novuProject(emulator).idle()

    expect(novuProject(emulator).executions()[0]).toMatchObject({ status: "failed" })
  })
})

describe("novu inbox", () => {
  it("starts a session, lists notifications, marks them read and pushes new ones on the socket", async () => {
    seedNovu(emulator.store, {
      workflows: [
        {
          workflowId: "ping",
          steps: [{ stepId: "bell", type: "in_app", body: "ping {{payload.n}}" }],
        },
      ],
    })
    vi.stubGlobal("WebSocket", WebSocket)

    const inbox = new NovuInbox({
      applicationIdentifier: "app-ident",
      subscriber: "u5",
      apiUrl: origin(),
      socketUrl: `${sockets.url}/`,
      socketOptions: { socketType: "cloud" },
    })
    const received = new Promise<string>((resolve) =>
      inbox.on("notifications.notification_received", ({ result }) => resolve(result.body)),
    )

    await sdk().trigger({ workflowId: "ping", to: "u5", payload: { n: 1 } })
    await novuProject(emulator).idle()

    const first = await inbox.notifications.list({ limit: 10 })

    expect(first.data?.notifications.map((n) => n.body)).toEqual(["ping 1"])
    await vi.waitFor(() => expect(novuProject(emulator).openInboxes()["u5"]).toBe(1))
    await sdk().trigger({ workflowId: "ping", to: "u5", payload: { n: 2 } })

    expect(await received).toBe("ping 2")

    await first.data?.notifications[0]?.read()

    expect(
      novuProject(emulator)
        .inbox("u5")
        .find((m) => m.content === "ping 1")?.read,
    ).toBe(true)
    await inbox.socket.disconnect()
    vi.unstubAllGlobals()
  })

  it("refuses a session for another application", async () => {
    const response = await fetch(`${origin()}/v1/inbox/session`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ applicationIdentifier: "other", subscriber: "u6" }),
    })

    expect(response.status).toBe(400)
  })
})
