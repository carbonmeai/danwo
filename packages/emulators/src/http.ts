import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http"
import { Readable } from "node:stream"

/**
 * The small HTTP layer every emulator is built on: an `App` that takes a fetch `Request` and
 * returns a `Response`, with path routes (`/v1/customers/:id`), middleware that can see the
 * downstream response, and an error hook. It runs in-process; `serve` puts it on a real port when a client needs one.
 */

/** Calls the rest of the chain and resolves to the response it produced. */
export type Next = () => Promise<Response>

/** What a route or middleware may return; `undefined` means "nothing here, keep going". */
type Outcome = Response | undefined | void

/** A route handler. */
export type Handler = (c: Context) => Outcome | Promise<Outcome>

/** Middleware runs before routes and may wrap them by awaiting `next()`. */
export type Middleware = (c: Context, next: Next) => Outcome | Promise<Outcome>

/** Turns an error thrown anywhere in the chain into a response. */
export type ErrorHandler = (error: unknown, c: Context) => Response | Promise<Response>

/** A value a form body field can hold. */
type FormValue = string | File

/** Extra response headers, as a plain record. */
export type HeaderRecord = Record<string, string>

/** The incoming request, with its body read at most once and kept for later readers. */
class IncomingRequest {
  readonly raw: Request
  readonly method: string
  readonly url: string
  readonly path: string
  private readonly params: Record<string, string>
  private readonly search: URLSearchParams
  private bytes: Promise<ArrayBuffer> | undefined

  constructor(raw: Request, params: Record<string, string>) {
    const url = new URL(raw.url)

    this.raw = raw
    this.method = raw.method.toUpperCase()
    this.url = raw.url
    this.path = url.pathname
    this.search = url.searchParams
    this.params = params
  }

  /** A path parameter such as `id` in `/v1/customers/:id`, URL-decoded; empty if absent. */
  param(name: string): string {
    return this.params[name] ?? ""
  }

  /** The first query value for `name`. */
  query(name: string): string | undefined {
    return this.search.get(name) ?? undefined
  }

  /** One header (case-insensitive) or, without a name, every header with lower-case names. */
  header(name: string): string | undefined
  header(): HeaderRecord
  header(name?: string): string | undefined | HeaderRecord {
    if (name !== undefined) return this.raw.headers.get(name) ?? undefined

    return Object.fromEntries(this.raw.headers)
  }

  /** The raw body bytes. Safe to call more than once. */
  arrayBuffer(): Promise<ArrayBuffer> {
    this.bytes ??= this.raw.arrayBuffer()

    return this.bytes
  }

  async text(): Promise<string> {
    return new TextDecoder().decode(await this.arrayBuffer())
  }

  async json<T = unknown>(): Promise<T> {
    return JSON.parse(await this.text()) as T
  }

  /**
   * A URL-encoded or multipart form body as a record. A field sent more than once keeps its last
   * value. Any other content type gives an empty record.
   */
  async parseBody(): Promise<Record<string, FormValue>> {
    const type = this.raw.headers.get("content-type") ?? ""

    if (!/application\/x-www-form-urlencoded|multipart\/form-data/i.test(type)) return {}

    const form = await new Response(await this.arrayBuffer(), {
      headers: { "content-type": type },
    }).formData()
    const fields: Record<string, FormValue> = {}

    for (const [key, value] of form) fields[key] = value

    return fields
  }
}

/** One request's view: the request, response builders and headers to add to the response. */
export class Context {
  readonly req: IncomingRequest
  private readonly extraHeaders = new Headers()

  constructor(req: IncomingRequest) {
    this.req = req
  }

  /** Adds a header to whatever response this request ends with. */
  header(name: string, value: string): void {
    this.extraHeaders.set(name, value)
  }

  body(data: BodyInit | null, status = 200, headers: HeaderRecord = {}): Response {
    return new Response(data, { status, headers })
  }

  json(value: unknown, status = 200, headers: HeaderRecord = {}): Response {
    return this.typed(JSON.stringify(value), "application/json", status, headers)
  }

  text(value: string, status = 200, headers: HeaderRecord = {}): Response {
    return this.typed(value, "text/plain; charset=UTF-8", status, headers)
  }

  html(markup: string, status = 200, headers: HeaderRecord = {}): Response {
    return this.typed(markup, "text/html; charset=UTF-8", status, headers)
  }

  redirect(location: string, status = 302): Response {
    return new Response(null, { status, headers: { location } })
  }

  /** The response with the headers set through `header()` added (existing ones win). */
  finish(response: Response): Response {
    if ([...this.extraHeaders].length === 0) return response

    const headers = new Headers(response.headers)

    for (const [name, value] of this.extraHeaders) if (!headers.has(name)) headers.set(name, value)

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    })
  }

  private typed(body: string, type: string, status: number, headers: HeaderRecord): Response {
    const merged = new Headers(headers)

    if (!merged.has("content-type")) merged.set("content-type", type)

    return new Response(status === 204 || status === 304 ? null : body, {
      status,
      headers: merged,
    })
  }
}

interface Route {
  readonly method: string
  readonly segments: readonly string[]
  readonly handler: Handler
}

/** Matches `/a/:b/c` against a path, returning the decoded parameters or `undefined`. */
function matchPath(segments: readonly string[], path: string): Record<string, string> | undefined {
  const parts = path.split("/").filter((part) => part !== "")

  if (parts.length !== segments.length) return undefined

  const params: Record<string, string> = {}

  for (const [index, segment] of segments.entries()) {
    const part = parts[index] ?? ""

    if (segment.startsWith(":")) params[segment.slice(1)] = decodeURIComponent(part)
    else if (segment !== part) return undefined
  }

  return params
}

function defaultError(error: unknown, c: Context): Response {
  return c.text(error instanceof Error ? error.message : String(error), 500)
}

/** An in-process HTTP application: middleware, then the first route matching method and path. */
export class App {
  private readonly routes: Route[] = []
  private readonly middleware: Middleware[] = []
  private onErrorHandler: ErrorHandler = defaultError

  use(middleware: Middleware): void {
    this.middleware.push(middleware)
  }

  get(path: string, handler: Handler): void {
    this.add("GET", path, handler)
  }

  post(path: string, handler: Handler): void {
    this.add("POST", path, handler)
  }

  put(path: string, handler: Handler): void {
    this.add("PUT", path, handler)
  }

  patch(path: string, handler: Handler): void {
    this.add("PATCH", path, handler)
  }

  delete(path: string, handler: Handler): void {
    this.add("DELETE", path, handler)
  }

  onError(handler: ErrorHandler): void {
    this.onErrorHandler = handler
  }

  /** Handles one request. Never throws: errors go through the error hook. */
  async fetch(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname
    const method = request.method.toUpperCase()
    const found = this.find(method, path)
    const c = new Context(new IncomingRequest(request, found?.params ?? {}))

    try {
      return c.finish(await this.run(c, found?.route.handler))
    } catch (error) {
      return c.finish(await this.onErrorHandler(error, c))
    }
  }

  private add(method: string, path: string, handler: Handler): void {
    this.routes.push({ method, segments: path.split("/").filter((s) => s !== ""), handler })
  }

  private find(
    method: string,
    path: string,
  ): { route: Route; params: Record<string, string> } | undefined {
    for (const route of this.routes) {
      if (route.method !== method) continue

      const params = matchPath(route.segments, path)

      if (params) return { route, params }
    }

    return undefined
  }

  /** Runs the middleware in order, then the route; an empty end of the chain is a 404. */
  private async run(c: Context, handler: Handler | undefined): Promise<Response> {
    const step = async (index: number): Promise<Response> => {
      const middleware = this.middleware[index]

      if (middleware) {
        let downstream: Promise<Response> | undefined
        const next = () => (downstream ??= step(index + 1))

        return (await middleware(c, next)) ?? next()
      }

      const response = handler ? await handler(c) : undefined

      return response ?? c.text("Not Found", 404)
    }

    return step(0)
  }
}

/** What `serve` needs: the handler and a port (0 picks a free one). */
export interface ServeOptions {
  readonly fetch: (request: Request) => Response | Promise<Response>
  readonly port: number
  readonly hostname?: string
}

function toRequest(incoming: IncomingMessage, origin: string): Request {
  const headers = new Headers()

  for (const [name, value] of Object.entries(incoming.headers)) {
    if (Array.isArray(value)) for (const item of value) headers.append(name, item)
    else if (value !== undefined) headers.set(name, value)
  }

  const method = incoming.method ?? "GET"
  const hasBody = method !== "GET" && method !== "HEAD"

  return new Request(new URL(incoming.url ?? "/", origin), {
    method,
    headers,
    ...(hasBody && {
      body: Readable.toWeb(incoming) as ReadableStream<Uint8Array>,
      duplex: "half",
    }),
  })
}

async function writeResponse(
  response: Response,
  outgoing: ServerResponse,
  method: string,
): Promise<void> {
  const cookies = response.headers.getSetCookie()

  outgoing.statusCode = response.status
  for (const [name, value] of response.headers)
    if (name !== "set-cookie") outgoing.setHeader(name, value)
  if (cookies.length > 0) outgoing.setHeader("set-cookie", cookies)

  if (method === "HEAD" || !response.body) {
    outgoing.end()

    return
  }

  outgoing.end(Buffer.from(await response.arrayBuffer()))
}

/** Serves a fetch-style handler over real HTTP, for clients that need a socket. */
export function serve(options: ServeOptions): Server {
  const hostname = options.hostname ?? "127.0.0.1"
  const server = createServer((incoming, outgoing) => {
    const origin = `http://${incoming.headers.host ?? hostname}`

    void (async () => {
      try {
        await writeResponse(
          await options.fetch(toRequest(incoming, origin)),
          outgoing,
          incoming.method ?? "GET",
        )
      } catch (error) {
        outgoing.statusCode = 500
        outgoing.end(error instanceof Error ? error.message : String(error))
      }
    })()
  })

  server.listen(options.port, hostname)

  return server
}
