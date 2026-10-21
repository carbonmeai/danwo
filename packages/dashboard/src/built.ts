/**
 * The dashboard as an installed package runs it: its pages and server routes built ahead of time
 * into `dist/`, behind a plain Node server, so `danwo serve` needs no bundler. Built files under
 * `dist/client` are sent as they are; every other request goes to the built server's handler, and
 * its answer is streamed back, so the live pages' event streams arrive as they are written.
 */
import { once } from "node:events"
import { createReadStream } from "node:fs"
import { stat } from "node:fs/promises"
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http"
import { extname, join, resolve, sep } from "node:path"
import { buffer } from "node:stream/consumers"
import { pathToFileURL } from "node:url"

/** What the built server module exports by default. */
interface ServerEntry {
  fetch(request: Request): Response | Promise<Response>
}

/** Media types of the files a dashboard build holds. */
const TYPES: Readonly<Record<string, string>> = {
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".json": "application/json",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
}

function isServerEntry(value: unknown): value is ServerEntry {
  return (
    typeof value === "object" && value !== null && typeof Reflect.get(value, "fetch") === "function"
  )
}

/** The built server's handler, from `dist/server/server.js`. */
async function loadEntry(dist: string): Promise<ServerEntry> {
  const module: unknown = await import(pathToFileURL(join(dist, "server", "server.js")).href)
  const entry: unknown = Reflect.get(Object(module), "default")

  if (!isServerEntry(entry)) throw new Error(`no request handler in the dashboard build at ${dist}`)

  return entry
}

/** The file under `client` a request path names, when there is one; never a path outside it. */
async function builtFile(client: string, pathname: string) {
  let decoded: string

  try {
    decoded = decodeURIComponent(pathname)
  } catch {
    return undefined
  }

  const path = resolve(client, `.${decoded}`)

  if (!path.startsWith(client + sep)) return undefined

  const info = await stat(path).catch(() => undefined)

  return info?.isFile() ? { path, size: info.size } : undefined
}

/**
 * A Node request as a fetch `Request`. The dashboard's pages only send small calls, so a body is
 * read whole first.
 */
async function fetchRequest(incoming: IncomingMessage, origin: string): Promise<Request> {
  const method = incoming.method ?? "GET"
  const headers = new Headers()

  for (const [name, value] of Object.entries(incoming.headers))
    for (const item of [value ?? []].flat()) headers.append(name, item)

  const hasBody = method !== "GET" && method !== "HEAD"

  return new Request(new URL(incoming.url ?? "/", origin), {
    method,
    headers,
    ...(hasBody && { body: await buffer(incoming) }),
  })
}

/** Writes `response` to `outgoing` as its body arrives; stops reading when the client leaves. */
async function stream(response: Response, outgoing: ServerResponse, method: string) {
  const headers = [...response.headers].filter(([name]) => name !== "set-cookie")
  const cookies = response.headers.getSetCookie().map((cookie) => ["set-cookie", cookie])

  outgoing.writeHead(response.status, [...headers, ...cookies].flat())

  if (method === "HEAD" || response.body === null) {
    outgoing.end()

    return
  }

  const reader = response.body.getReader()
  const closed = once(outgoing, "close")

  outgoing.once("close", () => void reader.cancel().catch(() => undefined))

  for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
    if (!outgoing.write(chunk.value)) await Promise.race([once(outgoing, "drain"), closed])
    if (outgoing.destroyed) return
  }

  outgoing.end()
}

/** Sends a built file; hashed assets are kept by the browser for good. */
function sendFile(
  file: { path: string; size: number },
  pathname: string,
  outgoing: ServerResponse,
) {
  outgoing.writeHead(200, {
    "content-type": TYPES[extname(file.path)] ?? "application/octet-stream",
    "content-length": file.size,
    "cache-control": pathname.startsWith("/assets/")
      ? "public, max-age=31536000, immutable"
      : "no-cache",
  })
  createReadStream(file.path).pipe(outgoing)
}

/** Starts the dashboard build in `dist` on `host:port` (0 picks a free port); the server, listening. */
export async function serveBuilt(dist: string, port: number, host = "127.0.0.1"): Promise<Server> {
  const entry = await loadEntry(dist)
  const client = join(dist, "client")
  const server = createServer((incoming, outgoing) => {
    const method = incoming.method ?? "GET"
    const pathname = new URL(incoming.url ?? "/", "http://dashboard").pathname

    void (async () => {
      const file =
        method === "GET" || method === "HEAD" ? await builtFile(client, pathname) : undefined

      if (file !== undefined) return sendFile(file, pathname, outgoing)

      const origin = `http://${incoming.headers.host ?? host}`
      const response = await entry.fetch(await fetchRequest(incoming, origin))

      await stream(response, outgoing, method)
    })().catch((error: unknown) => {
      if (!outgoing.headersSent) outgoing.writeHead(500, { "content-type": "text/plain" })
      outgoing.end(error instanceof Error ? error.message : String(error))
    })
  })

  server.listen(port, host)
  await Promise.race([
    once(server, "listening"),
    once(server, "error").then(([error]: unknown[]) => Promise.reject(error)),
  ])

  return server
}
