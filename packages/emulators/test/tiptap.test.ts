import { createHmac } from "node:crypto"
import { once } from "node:events"

import { HocuspocusProvider, HocuspocusProviderWebsocket } from "@hocuspocus/provider"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { WebSocket } from "ws"
import * as Y from "yjs"
import { z } from "zod"

import { serve } from "../src/http.ts"
import {
  createEmulator,
  type Emulator,
  seedTiptap,
  serveSockets,
  type SocketServer,
  tiptap,
  tiptapCollab,
} from "../src/index.ts"
import { listeningPort } from "../src/net.ts"

const SECRET = "collab-secret"

let emulator: Emulator
let api: ReturnType<typeof serve>
let sockets: SocketServer
let providers: HocuspocusProvider[]
let websockets: HocuspocusProviderWebsocket[]

/** An HS256 JWT signed with the app's collaboration secret, as the app's server mints one. */
const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url")

function token(claims: Record<string, unknown> = {}, secret = SECRET): string {
  const body = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ iat: Math.floor(Date.now() / 1000), ...claims })}`

  return `${body}.${createHmac("sha256", secret).update(body).digest("base64url")}`
}

/** An editor of `name` connected to the emulator's socket, as Tiptap's provider connects. */
function editor(name: string, auth = token()): HocuspocusProvider {
  const websocketProvider = new HocuspocusProviderWebsocket({
    url: `${sockets.url}?__version=3.7.2`,
    WebSocketPolyfill: WebSocket,
  })
  const provider = new HocuspocusProvider({
    websocketProvider,
    name,
    token: auth,
    document: new Y.Doc(),
  })

  provider.attach()
  providers.push(provider)
  websockets.push(websocketProvider)

  return provider
}

async function synced(provider: HocuspocusProvider): Promise<void> {
  if (provider.isSynced) return
  await new Promise<void>((resolve) => provider.on("synced", () => resolve()))
}

/** Types into the editor's `default` fragment the way Tiptap stores a paragraph. */
function type(provider: HocuspocusProvider, text: string): void {
  const paragraph = new Y.XmlElement("paragraph")

  paragraph.insert(0, [new Y.XmlText(text)])
  provider.document.getXmlFragment("default").insert(0, [paragraph])
}

function rest(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers)

  headers.set("Authorization", "api-key")

  return fetch(`http://127.0.0.1:${listeningPort(api)}/api${path}`, { ...init, headers })
}

/** The editor's copy of the document, as text the assertions read. */
const seen = (provider: HocuspocusProvider) =>
  JSON.stringify(provider.document.getXmlFragment("default").toJSON())

beforeEach(async () => {
  emulator = createEmulator(tiptap)
  seedTiptap(emulator, { apps: [{ id: "app1", secret: SECRET, apiKey: "api-key" }] })
  api = serve({ fetch: emulator.fetch, port: 0 })
  await once(api, "listening")
  if (!emulator.connect) throw new Error("the Tiptap emulator answers sockets")
  sockets = await serveSockets(emulator.connect)
  providers = []
  websockets = []
})

afterEach(async () => {
  for (const provider of providers) provider.destroy()
  for (const socket of websockets) socket.destroy()
  await sockets.close()
  await new Promise((resolve) => api.close(resolve))
  await emulator.close()
})

describe("tiptap collaboration", () => {
  it("syncs one editor's change to another and keeps the document", async () => {
    const alice = editor("note-1")
    const bob = editor("note-1")

    await Promise.all([synced(alice), synced(bob)])
    type(alice, "Hello from Alice")

    await vi.waitFor(() => expect(seen(bob)).toContain("Hello from Alice"))
    expect(await tiptapCollab(emulator).waitForText("note-1", "Hello from Alice")).toBe(
      "Hello from Alice",
    )
    expect(tiptapCollab(emulator).editors("note-1")).toBe(2)
  })

  it("reads and replaces a document over the REST API, and editors see the change", async () => {
    const alice = editor("note-2")

    await synced(alice)
    type(alice, "draft")
    await tiptapCollab(emulator).waitForText("note-2", "draft")

    const read = await rest("/documents/note-2?format=json")

    expect(await read.json()).toEqual({
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "draft" }] }],
    })

    const replaced = await rest("/documents/note-2?format=json", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "doc",
        content: [
          {
            type: "heading",
            attrs: { level: 1 },
            content: [{ type: "text", text: "Final", marks: [{ type: "bold" }] }],
          },
        ],
      }),
    })

    expect(replaced.status).toBe(204)
    await vi.waitFor(() => expect(seen(alice)).toContain("Final"))
    expect(tiptapCollab(emulator).json("note-2")).toEqual({
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 1 },
          content: [{ type: "text", text: "Final", marks: [{ type: "bold" }] }],
        },
      ],
    })
  })

  it("creates, duplicates through a Yjs update, lists and deletes documents", async () => {
    const created = await rest("/documents/a?format=json", {
      method: "POST",
      body: JSON.stringify({
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "one" }] }],
      }),
    })

    expect(created.status).toBe(204)
    expect((await rest("/documents/a", { method: "POST", body: "{}" })).status).toBe(409)

    const binary = await (await rest("/documents/a?format=yjs")).arrayBuffer()

    expect((await rest("/documents/b", { method: "POST", body: binary })).status).toBe(204)
    expect(tiptapCollab(emulator).text("b")).toBe("one")

    const listed = z
      .array(z.object({ name: z.string() }))
      .parse(await (await rest("/documents")).json())

    expect(listed.map((doc) => doc.name)).toEqual(["a", "b"])
    expect((await rest("/documents/a", { method: "DELETE" })).status).toBe(204)
    expect((await rest("/documents/a")).status).toBe(404)
  })

  it("refuses a token signed with another secret, and a wrong API key", async () => {
    const intruder = editor("note-3", token({}, "not-the-secret"))
    const reason = new Promise<string>((resolve) =>
      intruder.on("authenticationFailed", (event: { reason: string }) => resolve(event.reason)),
    )

    expect(await reason).toBe("invalid token")
    expect(
      (
        await fetch(`http://127.0.0.1:${listeningPort(api)}/api/documents`, {
          headers: { Authorization: "nope" },
        })
      ).status,
    ).toBe(401)
  })

  it("keeps a read-only editor's changes out of the document", async () => {
    const reader = editor("note-4", token({ readonlyDocumentNames: ["note-*"] }))
    const scope = new Promise<string>((resolve) =>
      reader.on("authenticated", (event: { scope: string }) => resolve(event.scope)),
    )

    expect(await scope).toBe("readonly")
    await synced(reader)
    type(reader, "should not land")
    await new Promise((resolve) => setTimeout(resolve, 200))
    expect(tiptapCollab(emulator).text("note-4")).toBe("")
  })

  it("refuses every token while a test says so", async () => {
    tiptapCollab(emulator).trouble({ permissionDenied: true })

    const denied = editor("note-5")

    expect(
      await new Promise<string>((resolve) =>
        denied.on("authenticationFailed", (event: { reason: string }) => resolve(event.reason)),
      ),
    ).toBe("permission denied by the test")
  })

  it("restores documents from a snapshot", async () => {
    await rest("/documents/kept?format=json", {
      method: "POST",
      body: JSON.stringify({
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "before" }] }],
      }),
    })

    const kept = emulator.snapshot()

    tiptapCollab(emulator).write("kept", {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "after" }] }],
    })
    expect(tiptapCollab(emulator).text("kept")).toBe("after")
    emulator.restore(kept)
    expect(tiptapCollab(emulator).text("kept")).toBe("before")
  })
})
