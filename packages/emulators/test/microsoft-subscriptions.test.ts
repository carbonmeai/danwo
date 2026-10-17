import { once } from "node:events"
import { createServer, type IncomingMessage, type Server } from "node:http"
import type { AddressInfo } from "node:net"

import type { ChangeNotificationCollection } from "@microsoft/microsoft-graph-types"
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest"

import type { Emulator } from "../src/define.ts"
import {
  type GraphSubscriptionEntry,
  graphSubscriptions,
  oneDrive,
  outlookMailbox,
} from "../src/microsoft/index.ts"
import { ADA, graphClient, graphEmulator, WORK_TENANT } from "./microsoft-graph.ts"

const SCOPES = "Mail.Read Files.Read Calendars.Read"
const HOUR = 60 * 60 * 1000

/** The app's notification endpoint: answers the handshake (unless told not to) and keeps what Graph posts. */
let app: Server
let appUrl: string
let echoValidation = true
const notifications: ChangeNotificationCollection[] = []

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []

  for await (const chunk of request) chunks.push(Buffer.from(chunk))

  return Buffer.concat(chunks).toString("utf8")
}

beforeAll(async () => {
  app = createServer((request, response) => {
    void (async () => {
      const token = new URL(request.url ?? "/", "http://app").searchParams.get("validationToken")
      const body = await readBody(request)

      if (token !== null) {
        response.writeHead(200, { "content-type": "text/plain" })
        response.end(echoValidation ? token : "nope")

        return
      }

      notifications.push(JSON.parse(body))
      response.writeHead(202)
      response.end()
    })()
  })
  app.listen(0, "127.0.0.1")
  await once(app, "listening")
  appUrl = `http://127.0.0.1:${(app.address() as AddressInfo).port}/notifications`
})

afterAll(() => {
  app.close()
})

let emulator: Emulator

beforeEach(() => {
  echoValidation = true
  notifications.length = 0
  emulator = graphEmulator({}, { deliveryPolicy: { retryDelaysMs: [], timeoutMs: 2_000 } })
})

afterEach(async () => {
  await emulator.close()
})

/**
 * Waits until `count` deliveries have been attempted (they start after the change, on a timer),
 * or `timeoutMs` passes, which is how a test sees that none came.
 */
async function delivered(count: number, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs

  while ((emulator.webhooks?.attempts().length ?? 0) < count && Date.now() < deadline)
    await new Promise((resolve) => setTimeout(resolve, 5))
  await emulator.webhooks?.idle()
}

function expiresIn(ms: number): string {
  return new Date(Date.now() + ms).toISOString()
}

function subscribe(resource: string, changeType: string, expirationDateTime = expiresIn(HOUR)) {
  return graphClient(emulator, ADA, SCOPES).api("/subscriptions").post({
    changeType,
    notificationUrl: appUrl,
    resource,
    expirationDateTime,
    clientState: "secret-from-the-app",
  })
}

describe("creating subscriptions", () => {
  it("validates the notification URL with Graph's handshake before creating", async () => {
    const created = await subscribe("me/mailFolders('Inbox')/messages", "created,updated")

    expect(created).toMatchObject({
      resource: "me/mailFolders('Inbox')/messages",
      changeType: "created,updated",
      clientState: "secret-from-the-app",
      notificationUrl: appUrl,
    })
    const stored: GraphSubscriptionEntry[] = graphSubscriptions(emulator)

    expect(stored).toMatchObject([
      { changeTypes: ["created", "updated"], clientState: "secret-from-the-app" },
    ])

    echoValidation = false
    await expect(subscribe("me/events", "created")).rejects.toMatchObject({
      statusCode: 400,
      code: "ValidationError",
    })
  })

  it("enforces expiry limits and the change types each resource supports", async () => {
    await expect(
      subscribe("me/messages", "created", expiresIn(8 * 24 * HOUR)),
    ).rejects.toMatchObject({
      statusCode: 400,
      message: expect.stringContaining("10080 minutes"),
    })
    await expect(subscribe("me/drive/root", "created")).rejects.toMatchObject({ statusCode: 400 })
    await expect(subscribe("me/contacts", "created")).rejects.toMatchObject({ statusCode: 400 })
    await expect(
      subscribe("me/drive/root", "updated", expiresIn(20 * 24 * HOUR)),
    ).resolves.toMatchObject({
      resource: "me/drive/root",
    })
  })

  it("renews, lists and deletes a subscription", async () => {
    const client = graphClient(emulator, ADA, SCOPES)
    const created = await subscribe("me/messages", "created")
    const later = expiresIn(2 * 24 * HOUR)
    const renewed = await client
      .api(`/subscriptions/${created.id}`)
      .patch({ expirationDateTime: later })

    expect(renewed.expirationDateTime).toBe(later)
    expect((await client.api("/subscriptions").get()).value).toHaveLength(1)

    await client.api(`/subscriptions/${created.id}`).delete()
    outlookMailbox(emulator, ADA).receive({ subject: "after delete" })
    await delivered(1, 100)

    expect(notifications).toEqual([])
    await expect(client.api(`/subscriptions/${created.id}`).get()).rejects.toMatchObject({
      statusCode: 404,
    })
  })
})

describe("notifications", () => {
  it("posts a created notification with the client state when mail arrives", async () => {
    const created = await subscribe("me/mailFolders('Inbox')/messages", "created")
    const id = outlookMailbox(emulator, ADA).receive({ from: "boss@contoso.test", subject: "Ping" })

    await delivered(1)

    expect(notifications).toEqual([
      {
        value: [
          expect.objectContaining({
            subscriptionId: created.id,
            changeType: "created",
            clientState: "secret-from-the-app",
            tenantId: WORK_TENANT,
            resourceData: expect.objectContaining({
              id,
              "@odata.type": "#Microsoft.Graph.Message",
            }),
          }),
        ],
      },
    ])
  })

  it("only tells a subscription about the folder and change types it asked for", async () => {
    await subscribe("me/mailFolders('Inbox')/messages", "created")
    outlookMailbox(emulator, ADA).receive({ subject: "archived", folder: "archive" })
    await delivered(1, 100)

    expect(notifications).toEqual([])
  })

  it("sends a drive's changes to its root subscription as updated", async () => {
    await subscribe("me/drive/root", "updated")
    oneDrive(emulator, ADA).put({ path: "/report.txt", content: "v1" })
    await delivered(1)

    expect(notifications[0]?.value?.[0]).toMatchObject({
      changeType: "updated",
      resource: "me/drive/root",
    })
  })

  it("delivers the same notification twice under a duplicate fault", async () => {
    await subscribe("me/messages", "created")
    emulator.webhooks?.setFault(() => ({ kind: "duplicate" }))
    outlookMailbox(emulator, ADA).receive({ subject: "twice" })
    await delivered(2)

    expect(notifications).toHaveLength(2)
    expect(notifications[0]).toEqual(notifications[1])
    expect(emulator.webhooks?.attempts().map((a) => a.fault)).toEqual([null, "duplicate"])
  })
})
