/**
 * Tiptap Cloud's collaboration server, as `@hocuspocus/provider` (and Tiptap's
 * `TiptapCollabProvider` on top of it) speaks to it over one WebSocket: binary messages that each
 * start with the document name (or a routing key) and a message type, then an authentication
 * token, the Yjs sync protocol, awareness (who is where) and stateless messages. Several
 * documents can share one socket; several sockets can edit one document.
 */
import { createHmac } from "node:crypto"

import * as decoding from "lib0/decoding"
import * as encoding from "lib0/encoding"
import * as awarenessProtocol from "y-protocols/awareness"
import * as syncProtocol from "y-protocols/sync"

import { asRecord } from "../json.ts"
import type { EmulatorSocket, SocketSession, SocketUpgrade } from "../sockets.ts"
import type { Store } from "../store.ts"
import { appTable, type TiptapApp, type TiptapDocuments } from "./documents.ts"

/** The message types of the protocol. */
const MESSAGE = {
  sync: 0,
  awareness: 1,
  auth: 2,
  queryAwareness: 3,
  stateless: 5,
  close: 7,
  syncStatus: 8,
} as const

/** The kinds of authentication message. */
const AUTH = { token: 0, permissionDenied: 1, authenticated: 2 } as const

/** A routing key is a document name, then `\0` and a session id when one socket multiplexes. */
const SEPARATOR = "\0"

/** One document a connection opened: whether it may write, and the awareness clients it brought. */
interface Opened {
  readonly key: string
  readonly name: string
  readonly scope: "read-write" | "readonly"
  readonly clients: Set<number>
}

/** One socket and the documents it opened, by routing key. */
interface Connection {
  readonly socket: EmulatorSocket
  readonly app: TiptapApp | undefined
  readonly opened: Map<string, Opened>
  /** Keys a token was refused for: their later messages are ignored. */
  readonly refused: Set<string>
}

const documentOf = (key: string) => {
  const at = key.indexOf(SEPARATOR)

  return at === -1 ? key : key.slice(0, at)
}

/** A message to send: the routing key and type, then whatever `write` adds. */
function message(
  key: string,
  type: number,
  write: (encoder: encoding.Encoder) => void,
): Uint8Array {
  const encoder = encoding.createEncoder()

  encoding.writeVarString(encoder, key)
  encoding.writeVarUint(encoder, type)
  write(encoder)

  return encoding.toUint8Array(encoder)
}

/** The claims of an HS256 JWT signed with `secret`, or undefined when it is not one. */
function verifiedClaims(token: string, secret: string): Record<string, unknown> | undefined {
  const [header, payload, signature] = token.split(".")

  if (header === undefined || payload === undefined || signature === undefined) return undefined

  const expected = createHmac("sha256", secret).update(`${header}.${payload}`).digest("base64url")

  if (expected !== signature) return undefined

  try {
    const claims = asRecord(JSON.parse(Buffer.from(payload, "base64url").toString("utf8")))
    const exp = claims?.["exp"]

    if (typeof exp === "number" && exp * 1000 < Date.now()) return undefined

    return claims
  } catch {
    return undefined
  }
}

/** Whether `name` matches one of a token's document name patterns (`*` matches any run). */
function listed(patterns: unknown, name: string): boolean {
  if (!Array.isArray(patterns)) return false

  return patterns.some((pattern) => {
    if (typeof pattern !== "string") return false

    const regex = new RegExp(
      `^${pattern
        .split("*")
        .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
        .join(".*")}$`,
    )

    return regex.test(name)
  })
}

/**
 * What a token lets a connection do to `name`: write, only read, or nothing (with why). A token
 * signed with the app's secret may limit itself with `allowedDocumentNames` and
 * `readonlyDocumentNames`; an app with no secret seeded takes any token.
 */
function scopeOf(app: TiptapApp | undefined, token: string, name: string): string {
  if (app?.secret === null || app?.secret === undefined) return "read-write"

  const claims = verifiedClaims(token, app.secret)

  if (claims === undefined) return "invalid token"
  if (listed(claims["readonlyDocumentNames"], name)) return "readonly"
  if (claims["allowedDocumentNames"] !== undefined && !listed(claims["allowedDocumentNames"], name))
    return "document not allowed"

  return "read-write"
}

/** The collaboration server: connections and the documents they edit together. */
export class TiptapCollab {
  private readonly connections = new Set<Connection>()
  private readonly documents: TiptapDocuments
  private readonly store: Store
  private readonly awareness = new Map<string, awarenessProtocol.Awareness>()

  constructor(store: Store, documents: TiptapDocuments) {
    this.store = store
    this.documents = documents
    documents.onUpdate((name, update, origin) => this.broadcast(name, update, origin))
  }

  /** Answers a socket to `<appId>.collab.tiptap.cloud` (or any host the proxy sent here). */
  open(socket: EmulatorSocket, upgrade: SocketUpgrade): SocketSession {
    const appId = /^([^.]+)\.collab\.tiptap\.cloud$/.exec(upgrade.url.hostname)?.[1]
    const apps = appTable(this.store)
    const app = (appId === undefined ? undefined : apps.get(appId)) ?? apps.all()[0]
    const connection: Connection = { socket, app, opened: new Map(), refused: new Set() }

    this.connections.add(connection)

    return {
      message: (data) => {
        if (typeof data !== "string") void this.handle(connection, data)
      },
      closed: () => this.drop(connection),
    }
  }

  /** The connections editing `name` right now. */
  editors(name: string): number {
    return [...this.connections].filter((connection) =>
      [...connection.opened.values()].some((opened) => opened.name === name),
    ).length
  }

  /** Closes every socket; providers reconnect and sync again. */
  closeAll(): void {
    for (const connection of this.connections) connection.socket.close(4200, "Emulator reset")
    this.connections.clear()
    for (const awareness of this.awareness.values()) awareness.destroy()
    this.awareness.clear()
  }

  private awarenessOf(name: string): awarenessProtocol.Awareness {
    const found = this.awareness.get(name)

    if (found) return found

    const awareness = new awarenessProtocol.Awareness(this.documents.open(name))

    awareness.setLocalState(null)
    this.awareness.set(name, awareness)

    return awareness
  }

  private async handle(connection: Connection, data: Uint8Array): Promise<void> {
    const decoder = decoding.createDecoder(data)
    const key = decoding.readVarString(decoder)
    const type = decoding.readVarUint(decoder)

    if (connection.refused.has(key)) return

    if (type === MESSAGE.auth) {
      this.authenticate(connection, key, decoder)

      return
    }

    const opened = connection.opened.get(key)

    if (opened === undefined) return

    const delay = this.documents.trouble().syncDelayMs

    if (delay > 0 && type === MESSAGE.sync)
      await new Promise((resolve) => setTimeout(resolve, delay))

    switch (type) {
      case MESSAGE.sync:
        this.sync(connection, opened, decoder)
        break
      case MESSAGE.awareness:
        this.applyAwareness(connection, opened, decoding.readVarUint8Array(decoder))
        break
      case MESSAGE.queryAwareness:
        this.sendAwareness(connection, opened)
        break
      case MESSAGE.stateless:
        this.stateless(connection, opened, decoding.readVarString(decoder))
        break
      case MESSAGE.close:
        connection.opened.delete(key)
        break
      default:
    }
  }

  private authenticate(connection: Connection, key: string, decoder: decoding.Decoder): void {
    if (decoding.readVarUint(decoder) !== AUTH.token) return

    const token = decoding.readVarString(decoder)
    const name = documentOf(key)
    const scope = this.documents.trouble().permissionDenied
      ? "permission denied by the test"
      : scopeOf(connection.app, token, name)

    if (scope !== "read-write" && scope !== "readonly") {
      connection.refused.add(key)
      connection.socket.send(
        message(key, MESSAGE.auth, (encoder) => {
          encoding.writeVarUint(encoder, AUTH.permissionDenied)
          encoding.writeVarString(encoder, scope)
        }),
      )

      return
    }

    connection.opened.set(key, { key, name, scope, clients: new Set() })
    this.documents.open(name)
    connection.socket.send(
      message(key, MESSAGE.auth, (encoder) => {
        encoding.writeVarUint(encoder, AUTH.authenticated)
        encoding.writeVarString(encoder, scope)
      }),
    )
  }

  private sync(connection: Connection, opened: Opened, decoder: decoding.Decoder): void {
    const doc = this.documents.open(opened.name)
    const encoder = encoding.createEncoder()

    encoding.writeVarString(encoder, opened.key)
    encoding.writeVarUint(encoder, MESSAGE.sync)

    const start = encoding.length(encoder)
    const kind = decoding.peekVarUint(decoder)

    if (opened.scope === "readonly" && kind !== syncProtocol.messageYjsSyncStep1) {
      connection.socket.send(
        message(opened.key, MESSAGE.syncStatus, (out) => encoding.writeVarInt(out, 0)),
      )

      return
    }

    syncProtocol.readSyncMessage(decoder, encoder, doc, connection)

    if (encoding.length(encoder) > start) connection.socket.send(encoding.toUint8Array(encoder))

    if (kind === syncProtocol.messageYjsSyncStep1) {
      /* The server asks for what the client has that it does not, as Hocuspocus does. */
      connection.socket.send(
        message(opened.key, MESSAGE.sync, (out) => syncProtocol.writeSyncStep1(out, doc)),
      )
    } else {
      connection.socket.send(
        message(opened.key, MESSAGE.syncStatus, (out) => encoding.writeVarInt(out, 1)),
      )
      connection.socket.send(
        message(opened.key, MESSAGE.stateless, (out) =>
          encoding.writeVarString(
            out,
            JSON.stringify({ event: "document.saved", date: new Date().toISOString() }),
          ),
        ),
      )
    }
  }

  /** Sends a document's change to every other connection editing it. */
  private broadcast(name: string, update: Uint8Array, origin: unknown): void {
    for (const connection of this.connections) {
      if (connection === origin) continue

      for (const opened of connection.opened.values())
        if (opened.name === name)
          connection.socket.send(
            message(opened.key, MESSAGE.sync, (out) => syncProtocol.writeUpdate(out, update)),
          )
    }
  }

  private applyAwareness(connection: Connection, opened: Opened, update: Uint8Array): void {
    const awareness = this.awarenessOf(opened.name)
    const before = new Set(awareness.getStates().keys())

    awarenessProtocol.applyAwarenessUpdate(awareness, update, connection)
    for (const client of awareness.getStates().keys())
      if (!before.has(client)) opened.clients.add(client)

    for (const other of this.connections) {
      if (other === connection) continue
      for (const theirs of other.opened.values())
        if (theirs.name === opened.name)
          other.socket.send(
            message(theirs.key, MESSAGE.awareness, (out) =>
              encoding.writeVarUint8Array(out, update),
            ),
          )
    }
  }

  private sendAwareness(connection: Connection, opened: Opened): void {
    const awareness = this.awarenessOf(opened.name)
    const clients = [...awareness.getStates().keys()]

    if (clients.length === 0) return

    connection.socket.send(
      message(opened.key, MESSAGE.awareness, (out) =>
        encoding.writeVarUint8Array(
          out,
          awarenessProtocol.encodeAwarenessUpdate(awareness, clients),
        ),
      ),
    )
  }

  /** Answers the stateless actions Tiptap's provider sends: listing versions (there are none). */
  private stateless(connection: Connection, opened: Opened, payload: string): void {
    try {
      if (asRecord(JSON.parse(payload))?.["action"] !== "versions.list") return
    } catch {
      return
    }

    connection.socket.send(
      message(opened.key, MESSAGE.stateless, (out) =>
        encoding.writeVarString(out, JSON.stringify({ event: "versions.list", versions: [] })),
      ),
    )
  }

  private drop(connection: Connection): void {
    this.connections.delete(connection)

    for (const opened of connection.opened.values()) {
      if (opened.clients.size === 0) continue

      const awareness = this.awarenessOf(opened.name)
      const gone = [...opened.clients]

      awarenessProtocol.removeAwarenessStates(awareness, gone, "disconnect")

      const update = awarenessProtocol.encodeAwarenessUpdate(awareness, gone)

      for (const other of this.connections)
        for (const theirs of other.opened.values())
          if (theirs.name === opened.name)
            other.socket.send(
              message(theirs.key, MESSAGE.awareness, (out) =>
                encoding.writeVarUint8Array(out, update),
              ),
            )
    }
  }
}
