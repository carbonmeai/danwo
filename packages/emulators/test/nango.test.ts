import { once } from "node:events"
import { createServer, type Server } from "node:http"
import { text as readText } from "node:stream/consumers"

import { Nango } from "@nangohq/node"
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import { createEmulator, type Emulator } from "../src/define.ts"
import { github, seedGithub } from "../src/github/index.ts"
import { serve } from "../src/http.ts"
import {
  connectNangoBackends,
  nango,
  nangoEnvironment,
  nangoOutboundFaults,
  seedNango,
} from "../src/nango/index.ts"
import { listeningPort } from "../src/net.ts"

const SECRET = "11111111-2222-4333-8444-555555555555"

let emulator: Emulator
let server: Server
let baseUrl: string
let hook: Server
let hookUrl: string
const deliveries: { body: string; headers: Record<string, string> }[] = []

const client = (secretKey = SECRET) => new Nango({ secretKey, host: baseUrl })

beforeAll(async () => {
  server = serve({ fetch: (request) => emulator.fetch(request), port: 0 })
  await once(server, "listening")
  baseUrl = `http://127.0.0.1:${listeningPort(server)}`
  emulator = createEmulator(nango, { baseUrl })
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
  hookUrl = `http://127.0.0.1:${listeningPort(hook)}/nango`
})

afterAll(async () => {
  server.close()
  hook.close()
  await emulator.close()
})

beforeEach(() => {
  emulator.reset()
  deliveries.length = 0
  seedNango(emulator.store, {
    secretKeys: [SECRET],
    integrations: [
      { key: "google-drive", provider: "google-drive", name: "Google Drive" },
      { key: "hubspot", provider: "hubspot", name: "HubSpot" },
    ],
    connections: [{ integration: "hubspot", connectionId: "conn-1", endUser: { id: "u1" } }],
    webhook: { url: hookUrl },
    proxy: [
      {
        integration: "hubspot",
        method: "GET",
        path: "/crm/v3/objects/contacts*",
        body: { results: [{ id: "c1" }] },
      },
    ],
    actions: [{ integration: "hubspot", name: "create-contact", output: { id: "c2" } }],
  })
})

/** Runs a connect session through the hosted UI as the user would, returning the page it ends on. */
async function connectThroughUi(token: string, integration: string): Promise<string> {
  const chooser = await fetch(`${baseUrl}/choose?session_token=${token}`).then((r) => r.text())

  expect(chooser).toContain(integration)

  return fetch(`${baseUrl}/allow`, {
    method: "POST",
    body: new URLSearchParams({ session_token: token, integration, decision: "allow" }),
  }).then((r) => r.text())
}

describe("keys and errors", () => {
  it("refuses an unknown secret key with Nango's error envelope", async () => {
    const error = await client("bad")
      .listConnections()
      .catch((e: unknown) => e)

    expect(error).toMatchObject({
      response: { status: 401, data: { error: { code: "unknown_account" } } },
    })
  })

  it("leaves the Connect UI alone and faults the proxy fully", () => {
    expect(nangoOutboundFaults({ host: "connect.nango.dev", method: "GET", path: "/" })).toEqual([])
    expect(nangoOutboundFaults({ method: "GET", path: "/proxy/x" }).map((f) => f.kind)).toContain(
      "reset-after",
    )
  })
})

describe("connect sessions", () => {
  it("connects through the hosted UI, posts connect to the app, and sends a signed auth webhook", async () => {
    const session = await client().createConnectSession({
      end_user: { id: "u2", email: "ada@acme.test" },
      allowed_integrations: ["google-drive"],
    })

    expect(session.data.connect_link).toContain(session.data.token)

    const page = await connectThroughUi(session.data.token, "google-drive")

    expect(page).toContain('"type":"connect"')

    const listed = await client().listConnections({ userId: "u2" })

    expect(listed.connections.map((c) => c.provider_config_key)).toEqual(["google-drive"])

    await vi.waitFor(() => expect(deliveries).toHaveLength(1))

    const delivery = deliveries[0]

    expect(
      client().verifyIncomingWebhookRequest(delivery?.body ?? "", delivery?.headers ?? {}),
    ).toBe(true)
    expect(JSON.parse(delivery?.body ?? "{}")).toMatchObject({
      type: "auth",
      operation: "creation",
      success: true,
      providerConfigKey: "google-drive",
      endUser: { endUserId: "u2" },
    })
  })

  it("renews a connection through a reconnect session", async () => {
    const before = await client().getConnection("hubspot", "conn-1")
    const session = await client().createReconnectSession({
      connection_id: "conn-1",
      integration_id: "hubspot",
    })

    await connectThroughUi(session.data.token, "hubspot")

    const after = await client().getConnection("hubspot", "conn-1")

    expect(Reflect.get(after.credentials, "access_token")).not.toBe(
      Reflect.get(before.credentials, "access_token"),
    )
    await vi.waitFor(() =>
      expect(JSON.parse(deliveries[0]?.body ?? "{}").operation).toBe("override"),
    )
  })
})

describe("connections and credentials", () => {
  it("refreshes an expired token, and fails a revoked one with a refresh error and webhook", async () => {
    const first = await client().getToken("hubspot", "conn-1")
    const forced = await client().getConnection("hubspot", "conn-1", true)

    expect(Reflect.get(forced.credentials, "access_token")).not.toBe(first)

    nangoEnvironment(emulator).revoke("hubspot", "conn-1")

    const error = await client()
      .getConnection("hubspot", "conn-1")
      .catch((e: unknown) => e)

    expect(error).toMatchObject({ response: { status: 424 } })
    await vi.waitFor(() =>
      expect(JSON.parse(deliveries[0]?.body ?? "{}")).toMatchObject({
        operation: "refresh",
        success: false,
      }),
    )
  })

  it("deletes a connection", async () => {
    await client().deleteConnection("hubspot", "conn-1")

    expect(nangoEnvironment(emulator).connections()).toEqual([])
  })
})

describe("proxy and actions", () => {
  it("answers proxied calls from seeds, records them, and runs seeded actions", async () => {
    const answer = await client().proxy({
      method: "GET",
      endpoint: "/crm/v3/objects/contacts",
      providerConfigKey: "hubspot",
      connectionId: "conn-1",
    })

    expect(answer.data).toEqual({ results: [{ id: "c1" }] })

    const output = await client().triggerAction("hubspot", "conn-1", "create-contact", {
      email: "x@y.test",
    })

    expect(output).toEqual({ id: "c2" })
    expect(
      nangoEnvironment(emulator)
        .calls()
        .map((c) => `${c.kind} ${c.path}`),
    ).toEqual(["proxy /crm/v3/objects/contacts", "action create-contact"])
  })

  it("forwards a proxied call to a connected backend emulator with the connection's token", async () => {
    const backend = createEmulator(github)

    seedGithub(backend.store, { users: [{ login: "ada" }] })
    connectNangoBackends(emulator, { github: backend })
    seedNango(emulator.store, {
      integrations: [{ key: "github", provider: "github" }],
      connections: [{ integration: "github", connectionId: "gh-1", accessToken: "gho_unknown" }],
    })

    const error = await client()
      .proxy({
        method: "GET",
        endpoint: "/user",
        providerConfigKey: "github",
        connectionId: "gh-1",
      })
      .catch((e: unknown) => e)

    /* The token was never issued by the GitHub emulator, so GitHub's own refusal comes back. */
    expect(error).toMatchObject({ response: { status: 401 } })
    expect(nangoEnvironment(emulator).calls()[0]).toMatchObject({
      integration: "github",
      status: 401,
    })
    await backend.close()
  })
})
