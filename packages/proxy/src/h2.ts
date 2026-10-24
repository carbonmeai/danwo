/**
 * HTTP/2 as the proxy speaks it to a client. Each stream is one exchange: its pseudo-headers say
 * where it goes, as a request line and `Host` do on HTTP/1.1, and it is answered through an
 * {@link H2Response}, which a reply writes as it writes an HTTP/1.1 response. Headers that only
 * mean something on one HTTP/1.1 connection never go out on HTTP/2, which forbids them.
 */
import {
  constants,
  type IncomingHttpHeaders,
  type OutgoingHttpHeaders,
  type ServerHttp2Stream,
  type ServerStreamResponseOptions,
} from "node:http2"
import { Writable } from "node:stream"

/** Headers about one HTTP/1.1 connection, which an HTTP/2 message must not carry (RFC 9113 8.2.2). */
const CONNECTION_SPECIFIC = new Set([
  "connection",
  "keep-alive",
  "proxy-connection",
  "proxy-authorization",
  "transfer-encoding",
  "upgrade",
  "http2-settings",
])

/** The 24 bytes an HTTP/2 client opens a cleartext connection with when it knows the server speaks it. */
const PREFACE = Buffer.from("PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n", "latin1")

/**
 * Whether a connection's first bytes are the HTTP/2 preface (as far as they go). Three bytes tell
 * it from any HTTP/1.1 method.
 */
export function isH2Preface(first: Buffer): boolean {
  const length = Math.min(first.length, PREFACE.length)

  return length >= 3 && first.subarray(0, length).equals(PREFACE.subarray(0, length))
}

/** A header block's fields as name and value pairs, pseudo-headers left out, repeated ones each their own. */
export function h2Pairs(headers: IncomingHttpHeaders): [string, string][] {
  const out: [string, string][] = []

  for (const [name, value] of Object.entries(headers)) {
    if (name.startsWith(":") || value === undefined) continue
    for (const one of Array.isArray(value) ? value : [value]) out.push([name, one])
  }

  return out
}

/** Whether a header may go out on HTTP/2: not a pseudo-header or a connection's, `TE` only as `trailers`. */
function goesOnH2(key: string, value: string): boolean {
  if (key.startsWith(":") || CONNECTION_SPECIFIC.has(key)) return false

  return key !== "te" || value.trim().toLowerCase() === "trailers"
}

/** `value` added to a header already seen: `Set-Cookie` values kept apart, others joined. */
function joinedValue(key: string, seen: string | string[] | undefined, value: string) {
  if (key === "set-cookie") return [...(Array.isArray(seen) ? seen : []), value]
  if (seen === undefined) return value

  return `${String(seen)}${key === "cookie" ? "; " : ", "}${value}`
}

/**
 * `pairs` as an HTTP/2 header block: names in lower case, connection-specific headers and `drop`'s
 * left out, `TE` only as `trailers`. A repeated header is joined into one value, as HTTP allows
 * (`Cookie` with `; `), except `Set-Cookie`, whose values stay apart.
 */
export function h2Headers(
  pairs: readonly (readonly [string, string])[],
  drop: readonly string[] = [],
): OutgoingHttpHeaders {
  const out: Record<string, string | string[]> = {}

  for (const [name, value] of pairs) {
    const key = name.toLowerCase()

    if (goesOnH2(key, value) && !drop.includes(key)) out[key] = joinedValue(key, out[key], value)
  }

  return out
}

/**
 * How a response's stream ends: with its headers (no body), after its body, or with trailers after
 * its body, which a response passed on from a server may carry.
 */
export type ResponseEnd = "headers" | "body" | "trailers"

/**
 * The response to one HTTP/2 stream, written as a stream like an HTTP/1.1 response: status and
 * headers, then the body, then trailers if any were added. It closes when its stream does; closed
 * before it finished, its client went away. `reset()` drops this stream alone, and the others on
 * the connection carry on.
 */
export class H2Response extends Writable {
  readonly stream: ServerHttp2Stream
  #headersSent = false
  readonly #trailers: OutgoingHttpHeaders = {}

  constructor(stream: ServerHttp2Stream) {
    super({ autoDestroy: false })
    this.stream = stream
    stream.on("wantTrailers", () => {
      try {
        stream.sendTrailers(this.#trailers)
      } catch {
        stream.close(constants.NGHTTP2_INTERNAL_ERROR)
      }
    })
    stream.once("close", () => this.destroy())
  }

  // fallow-ignore-next-line unused-class-member -- read through Reply, which holds either kind of response
  get headersSent(): boolean {
    return this.#headersSent
  }

  /**
   * Sends the status and headers, and no others (Node would add `Date`); for `"headers"`, the
   * stream ends with them.
   */
  // fallow-ignore-next-line unused-class-member -- called through Reply, which holds either kind of response
  respond(status: number, headers: OutgoingHttpHeaders, end: ResponseEnd): void {
    if (this.#headersSent || this.stream.destroyed || this.stream.headersSent) return
    this.#headersSent = true

    const options: ServerStreamResponseOptions & { readonly sendDate: boolean } = {
      sendDate: false,
      ...(end === "headers" && { endStream: true }),
      ...(end === "trailers" && { waitForTrailers: true }),
    }

    this.stream.respond({ ...headers, ":status": status }, options)
  }

  /** Trailers to send after the body; a response that ends with its headers sends none. */
  // fallow-ignore-next-line unused-class-member -- called through Reply, which holds either kind of response
  addTrailers(pairs: readonly (readonly [string, string])[]): void {
    Object.assign(this.#trailers, h2Headers(pairs))
  }

  /** Resets this stream with `code` (by default, as a server that failed while answering). */
  reset(code: number = constants.NGHTTP2_INTERNAL_ERROR): void {
    if (!this.stream.closed && !this.stream.destroyed) this.stream.close(code)
  }

  override _write(
    chunk: Buffer,
    encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    if (!this.stream.writable) {
      callback()

      return
    }

    this.stream.write(chunk, encoding, () => callback())
  }

  override _final(callback: (error?: Error | null) => void): void {
    if (!this.stream.writable) {
      callback()

      return
    }

    this.stream.end(() => callback())
  }

  /** Destroyed before its stream closed, the response failed partway: its stream is reset. */
  override _destroy(error: Error | null, callback: (error?: Error | null) => void): void {
    this.reset()
    callback(error)
  }
}
