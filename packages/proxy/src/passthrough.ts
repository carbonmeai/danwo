/**
 * Passing a request on to the host it was meant for, as the client sent it: method, path, headers
 * in their own case and order, and the body streamed through, then the answer streamed back. The
 * real host's certificate is checked as any client would check it, except on this machine, whose
 * apps serve HTTPS with development certificates from CAs Node does not know.
 */
import { Agent as HttpAgent, type ClientRequest, type IncomingMessage, request } from "node:http"
import { Agent as HttpsAgent, request as httpsRequest } from "node:https"
import { isIP, type Socket } from "node:net"

import { BodyTap } from "./bodies.ts"
import { isLoopback } from "./hosts.ts"
import { type Destination, type Incoming, MAX_HEADER_BYTES } from "./listener.ts"
import { isListening } from "./listening.ts"
import { OwnConnections } from "./loop.ts"
import { pairsOf, type Reply, type TappedBody } from "./reply.ts"

/** Headers about one hop of the connection, which never pass from one connection to the next. */
const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-connection",
  "proxy-authorization",
  "te",
  "upgrade",
  "http2-settings",
])

/** Methods a request without a body would still be framed as having one, if framing were left out. */
const BODY_METHODS = new Set(["POST", "PUT", "PATCH"])

/** The connections a proxy keeps to the hosts it passes calls on to. */
export class Upstreams {
  readonly http = new HttpAgent({ keepAlive: true })
  readonly https = new HttpsAgent({ keepAlive: true })
  readonly own = new OwnConnections()
  readonly #listenerPort: () => number

  constructor(listenerPort: () => number) {
    this.#listenerPort = listenerPort
  }

  /**
   * Whether a request to `destination`, arriving on `client`, would come back to the proxy: it is
   * addressed to the proxy's own port on this machine, or it arrived on a connection the proxy
   * opened itself.
   */
  isLoop(destination: Destination, client: Socket): boolean {
    return (
      (isLoopback(destination.hostname) && destination.port === this.#listenerPort()) ||
      this.own.isLoop(client)
    )
  }

  close(): void {
    this.http.destroy()
    this.https.destroy()
    this.own.destroyAll()
  }
}

/** The names a `Connection` header lists, which are hop-by-hop too. */
function connectionTokens(pairs: readonly (readonly [string, string])[]): Set<string> {
  return new Set(
    pairs
      .filter(([name]) => name.toLowerCase() === "connection")
      .flatMap(([, value]) => value.split(","))
      .map((token) => token.trim().toLowerCase())
      .filter(Boolean),
  )
}

/** `pairs` without the hop-by-hop headers, and without `drop`'s. */
export function endToEnd(
  pairs: readonly (readonly [string, string])[],
  drop: readonly string[] = [],
): [string, string][] {
  const named = connectionTokens(pairs)

  return pairs
    .filter(([name]) => {
      const lower = name.toLowerCase()

      return !HOP_BY_HOP.has(lower) && !named.has(lower) && !drop.includes(lower)
    })
    .map(([name, value]) => [name, value])
}

/** Whether the request's headers say a body follows. */
function hasBody(incoming: Incoming): boolean {
  if (incoming.bodyless === true) return false

  const length = incoming.headers["content-length"]

  return (
    incoming.headers["transfer-encoding"] !== undefined ||
    (length !== undefined && Number(length) > 0)
  )
}

/**
 * The headers passed on: the client's, minus hop-by-hop ones and `Expect` (the proxy has answered
 * `100-continue` itself and the body follows regardless), with `Host` added when the client sent
 * none, and an explicit empty length for a body-less POST, PUT or PATCH so it is not sent chunked.
 */
function forwardedHeaders(incoming: Incoming, authority: string): string[] {
  const body = hasBody(incoming)
  const drop = ["expect", ...(body ? [] : ["transfer-encoding"])]
  const pairs = endToEnd(pairsOf(incoming.rawHeaders), drop).filter(
    ([name]) => body || name.toLowerCase() !== "content-length",
  )

  if (!pairs.some(([name]) => name.toLowerCase() === "host")) pairs.unshift(["Host", authority])
  if (!body && BODY_METHODS.has(incoming.method)) pairs.push(["Content-Length", "0"])

  return pairs.flat()
}

/**
 * The address the proxy dials for `hostname`. `localhost` and its subdomains go to whichever of
 * `::1` and `127.0.0.1` the port listens on (a dev server often binds only one), and the
 * any-address to this machine, which Windows will not dial as `0.0.0.0`.
 */
export async function dialAddress(hostname: string, port: number): Promise<string> {
  if (hostname === "localhost" || hostname.endsWith(".localhost"))
    return (await isListening("::1", port)) ? "::1" : "127.0.0.1"
  if (hostname === "0.0.0.0") return "127.0.0.1"
  if (hostname === "::") return "::1"

  return hostname
}

/** The proxy's answer when it could not reach a host, naming the host and why. */
function unreachable(destination: Destination, error: Error): string {
  const code = Reflect.get(error, "code")

  return `danwo proxy: could not reach ${destination.hostname}:${destination.port} (${typeof code === "string" ? code : error.message})`
}

/** Errors that mean a kept-alive connection had closed under a request sent on it. */
function isStaleConnection(error: Error): boolean {
  const code = Reflect.get(error, "code")

  return code === "ECONNRESET" || code === "EPIPE" || error.message === "socket hang up"
}

export interface PassThroughOptions {
  readonly upstreams: Upstreams
  /** Called with the request body once it has all passed. */
  readonly onRequestBody: (body: TappedBody) => void
}

/** Sends `incoming` on to its destination and its answer back through `reply`. */
export async function passThrough(
  incoming: Incoming,
  reply: Reply,
  options: PassThroughOptions,
): Promise<void> {
  const { destination, message } = incoming
  const { upstreams } = options

  if (upstreams.isLoop(destination, incoming.connection.raw)) {
    message.resume()
    reply.send(
      502,
      [["content-type", "text/plain"]],
      Buffer.from(
        `danwo proxy: ${incoming.url} is the proxy itself; it would forward this request to itself forever`,
      ),
      incoming.method,
    )

    return
  }

  const secure = incoming.protocol === "https"
  const dial = await dialAddress(destination.hostname, destination.port)
  const authority = /^https?:\/\/([^/]*)/.exec(incoming.url)?.[1] ?? destination.hostname
  const headers = forwardedHeaders(incoming, authority)
  const withBody = hasBody(incoming)
  const tap = new BodyTap()
  let responded = false

  const send = (retry: boolean): ClientRequest => {
    const upstream = (secure ? httpsRequest : request)({
      host: dial,
      port: destination.port,
      method: incoming.method,
      path: incoming.path,
      headers,
      setHost: false,
      maxHeaderSize: MAX_HEADER_BYTES,
      agent: secure ? upstreams.https : upstreams.http,
      ...(secure && {
        ...(isIP(destination.hostname) === 0 && { servername: destination.hostname }),
        rejectUnauthorized: !isLoopback(destination.hostname),
      }),
    })

    upstream.on("socket", (socket: Socket) => upstreams.own.track(socket))
    upstream.on("response", (answer: IncomingMessage) => {
      responded = true
      respond(answer)
    })
    upstream.on("error", (error: Error) => {
      if (responded) {
        reply.response.destroy()

        return
      }

      if (retry && !withBody && upstream.reusedSocket && isStaleConnection(error)) {
        send(false).end()

        return
      }

      reply.send(
        502,
        [["content-type", "text/plain"]],
        Buffer.from(unreachable(destination, error)),
        incoming.method,
      )
    })
    /* The client went away before its answer had all gone out: stop asking for it. */
    reply.response.once("close", () => {
      if (!reply.response.writableFinished) upstream.destroy()
    })

    return upstream
  }

  const respond = (answer: IncomingMessage) => {
    reply.head(
      answer.statusCode ?? 502,
      endToEnd(pairsOf(answer.rawHeaders), ["transfer-encoding"]),
      answer.statusMessage,
    )
    answer.once("end", () => {
      if (answer.rawTrailers.length > 0) reply.response.addTrailers(pairsOf(answer.rawTrailers))
    })
    answer.on("error", () => reply.response.destroy())
    reply.pipeFrom(answer)
  }

  const upstream = send(true)

  message.on("data", (chunk: Buffer) => tap.add(chunk))
  message.once("end", () => {
    options.onRequestBody(tap.body)
    if (withBody && message.rawTrailers.length > 0)
      upstream.addTrailers(pairsOf(message.rawTrailers))
  })

  if (withBody) message.pipe(upstream)
  else {
    message.resume()
    upstream.end()
  }
}
