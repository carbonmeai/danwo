/**
 * WebSockets for emulators whose clients keep a socket open (Pusher channels, Novu's inbox,
 * Tiptap collaboration). An emulator answers each connection with a `SocketSession`; it never
 * sees the transport. `serveSockets` puts an emulator's sockets on a local `ws://` port, which is
 * where the danwo proxy sends upgrades to the provider's real hosts.
 */
import { type RawData, WebSocket, WebSocketServer } from "ws"

/** One connected client, as an emulator answers it. */
export interface EmulatorSocket {
  /** Sends a text frame for a string, a binary frame for bytes. */
  send(data: string | Uint8Array): void
  /** Closes the connection with `code` and an optional reason. */
  close(code?: number, reason?: string): void
}

/** The upgrade request a socket was opened with: its URL (original host and path) and headers. */
export interface SocketUpgrade {
  readonly url: URL
  readonly headers: Headers
}

/** What an emulator does with one connection's frames, and when it ends. */
export interface SocketSession {
  message(data: string | Uint8Array): void
  closed(): void
}

/**
 * Answers a new connection: a session for its frames, or `undefined` once the handler has closed
 * the socket itself (a bad key, an unknown path).
 */
export type SocketHandler = (
  socket: EmulatorSocket,
  upgrade: SocketUpgrade,
) => SocketSession | undefined

/** An emulator's sockets on a local port. */
export interface SocketServer {
  /** `ws://127.0.0.1:<port>`, a proxy route's `webSocket`. */
  readonly url: string
  /** Connections open right now. */
  open(): number
  close(): Promise<void>
}

/** The upgrade's headers as a `Headers`, multiple values joined. */
function headersOf(raw: Record<string, string | string[] | undefined>): Headers {
  const headers = new Headers()

  for (const [name, value] of Object.entries(raw)) {
    if (Array.isArray(value)) for (const item of value) headers.append(name, item)
    else if (value !== undefined) headers.set(name, value)
  }

  return headers
}

/** A frame's payload: text frames as strings, binary frames as bytes. */
function payloadOf(data: RawData, binary: boolean): string | Uint8Array {
  const bytes = Array.isArray(data)
    ? Buffer.concat(data)
    : data instanceof ArrayBuffer
      ? Buffer.from(data)
      : data

  return binary ? new Uint8Array(bytes) : bytes.toString("utf8")
}

/** The upgrade's URL with the host the client asked for, when the proxy passed it on. */
function upgradeUrl(path: string | undefined, headers: Headers): URL {
  const host = headers.get("x-forwarded-host") ?? headers.get("host") ?? "localhost"

  return new URL(path ?? "/", `ws://${host}`)
}

/** Wraps a `ws` connection as an `EmulatorSocket`. */
function emulatorSocket(ws: WebSocket): EmulatorSocket {
  return {
    send(data) {
      if (ws.readyState === WebSocket.OPEN) ws.send(data, { binary: typeof data !== "string" })
    },
    close(code = 1000, reason = "") {
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)
        ws.close(code, reason)
    },
  }
}

/** Serves `handler`'s sockets on 127.0.0.1 (port 0 picks a free one). */
export async function serveSockets(handler: SocketHandler, port = 0): Promise<SocketServer> {
  const server = new WebSocketServer({ host: "127.0.0.1", port })
  const sockets = new Set<WebSocket>()

  server.on("connection", (ws, request) => {
    const headers = headersOf(request.headers)
    const session = handler(emulatorSocket(ws), { url: upgradeUrl(request.url, headers), headers })

    sockets.add(ws)
    ws.on("message", (data, binary) => session?.message(payloadOf(data, binary)))
    ws.on("close", () => {
      sockets.delete(ws)
      session?.closed()
    })
    ws.on("error", () => ws.terminate())
  })

  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve)
    server.once("error", reject)
  })

  const address = server.address()

  if (address === null || typeof address === "string")
    throw new Error("the socket server is not listening on a TCP port")

  return {
    url: `ws://127.0.0.1:${address.port}`,
    open: () => sockets.size,
    async close() {
      for (const ws of sockets) ws.terminate()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    },
  }
}
