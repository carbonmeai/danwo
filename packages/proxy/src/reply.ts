/**
 * Writing a response back to the client, and keeping what was written for the flight recorder:
 * its status, headers as sent, and body (up to a bound). The record hears when the response has
 * gone out, or that the client went away before it had. The response is an HTTP/1.x one or an
 * HTTP/2 stream's, written the same way.
 */
import {
  type OutgoingHttpHeader,
  type ServerResponse,
  validateHeaderName,
  validateHeaderValue,
} from "node:http"
import type { Duplex, Readable } from "node:stream"

import { BodyTap } from "./bodies.ts"
import { h2Headers, H2Response, type ResponseEnd } from "./h2.ts"

/** Headers by lower-case name, repeated ones as arrays. */
export type HeaderRecord = Record<string, string | string[]>

/** A body kept for the record: the bytes held, and the whole body's size. */
export interface TappedBody {
  readonly bytes: Buffer
  readonly total: number
}

export interface ReplyEvents {
  /** The status and headers went out. */
  head(status: number, headers: HeaderRecord): void
  /** The whole response went out. */
  done(status: number, headers: HeaderRecord, body: TappedBody): void
  /** The client went away before the whole response went out. */
  aborted(): void
}

/** Pairs of a flat `[name, value, name, value]` list. */
export function pairsOf(flat: readonly string[]): [string, string][] {
  const pairs: [string, string][] = []

  for (let i = 0; i + 1 < flat.length; i += 2) pairs.push([flat[i] ?? "", flat[i + 1] ?? ""])

  return pairs
}

/** Whether Node would write this header: a valid name, and a value with no control characters. */
function isWritableHeader(name: string, value: string): boolean {
  try {
    validateHeaderName(name)
    validateHeaderValue(name, value)

    return true
  } catch {
    return false
  }
}

function recordOf(pairs: readonly (readonly [string, string])[]): HeaderRecord {
  const out: HeaderRecord = {}

  for (const [name, value] of pairs) {
    const key = name.toLowerCase()
    const seen = out[key]

    out[key] = seen === undefined ? value : Array.isArray(seen) ? [...seen, value] : [seen, value]
  }

  return out
}

/** Statuses whose response never has a body, whatever its headers say. */
function hasNoBody(status: number, method: string): boolean {
  return method === "HEAD" || status === 204 || status === 304 || (status >= 100 && status < 200)
}

/** gRPC's status headers, which follow a gRPC answer's messages as trailers. */
const GRPC_STATUS = new Set(["grpc-status", "grpc-message", "grpc-status-details-bin"])

/** Whether these headers are a gRPC answer's. */
function isGrpc(pairs: readonly (readonly [string, string])[]): boolean {
  return pairs.some(
    ([name, value]) =>
      name.toLowerCase() === "content-type" && /^application\/grpc(?:\+|;|$)/i.test(value.trim()),
  )
}

/** The gRPC status headers of a gRPC answer's headers; none for another kind of answer. */
function grpcStatusOf(
  pairs: readonly (readonly [string, string])[],
): (readonly [string, string])[] {
  if (!isGrpc(pairs)) return []

  return pairs.filter(([name]) => GRPC_STATUS.has(name.toLowerCase()))
}

/** How an HTTP/2 stream with a whole answer ends: with trailers, with its headers, or its body. */
function endOf(trailers: boolean, bodiless: boolean): ResponseEnd {
  if (trailers) return "trailers"

  return bodiless ? "headers" : "body"
}

/** Whether a header says how the body is framed, which the proxy sets itself. */
function isFraming(name: string): boolean {
  return name.toLowerCase() === "content-length" || name.toLowerCase() === "transfer-encoding"
}

/**
 * `pairs` framed for a body of `length` bytes. A response with no body (`length` undefined) keeps
 * the length it says it would have had (a HEAD's).
 */
function framed(
  pairs: readonly (readonly [string, string])[],
  length: number | undefined,
): (readonly [string, string])[] {
  if (length === undefined)
    return pairs.filter(([name]) => name.toLowerCase() !== "transfer-encoding")

  return [...pairs.filter(([name]) => !isFraming(name)), ["content-length", String(length)]]
}

/** One response to one client, written through here so the record sees what was sent. */
export class Reply {
  readonly response: ServerResponse | H2Response
  readonly #events: ReplyEvents
  readonly #tap = new BodyTap()
  #status = 0
  #headers: HeaderRecord = {}

  constructor(response: ServerResponse | H2Response, events: ReplyEvents) {
    this.response = response
    this.#events = events
    /* The headers a response goes out with are the ones it was given, and no others. */
    if (!(response instanceof H2Response)) response.sendDate = false
    response.once("finish", () => events.done(this.#status, this.#headers, this.#tap.body))
    response.once("close", () => {
      if (!response.writableFinished) events.aborted()
    })
  }

  /** Whether the response can still be written: its client is there, and it has not ended. */
  get open(): boolean {
    return !this.response.destroyed && !this.response.writableEnded
  }

  get headSent(): boolean {
    return this.response.headersSent
  }

  /**
   * Writes the status line and `pairs` (headers in the case and order given); a header Node would
   * refuse is left out, and a status message it would refuse is replaced by the standard one. On
   * HTTP/2, which has no status message, the headers go out in lower case without the ones about
   * an HTTP/1.1 connection, and `end` says how the stream ends.
   */
  head(
    status: number,
    pairs: readonly (readonly [string, string])[],
    message?: string,
    end: ResponseEnd = "trailers",
  ): void {
    if (!this.open || this.headSent) return

    const kept = pairs.filter(([name, value]) => isWritableHeader(name, value))
    const flat: OutgoingHttpHeader[] = kept.flat()

    this.#status = status
    this.#headers = recordOf(kept)

    if (this.response instanceof H2Response) {
      this.response.respond(status, h2Headers(kept), end)
      this.#events.head(status, this.#headers)

      return
    }

    try {
      if (message === undefined) this.response.writeHead(status, flat)
      else this.response.writeHead(status, message, flat)
    } catch {
      this.response.writeHead(status, flat)
    }

    this.#events.head(status, this.#headers)
  }

  /**
   * A whole response: status, headers and body, with `Content-Length` set from the body. On
   * HTTP/2, a gRPC answer with messages sends its `grpc-status` and `grpc-message` as trailers,
   * where gRPC reads them after the messages; one with none sends them with its headers, as gRPC's
   * trailers-only answer does.
   */
  send(
    status: number,
    pairs: readonly (readonly [string, string])[],
    body: Buffer,
    method: string,
  ): void {
    const empty = hasNoBody(status, method)
    const headers = framed(pairs, empty ? undefined : body.length)
    const bodiless = empty || body.length === 0
    const trailers = this.response instanceof H2Response && !bodiless ? grpcStatusOf(headers) : []

    this.head(
      status,
      headers.filter((pair) => !trailers.includes(pair)),
      undefined,
      endOf(trailers.length > 0, bodiless),
    )
    if (trailers.length > 0) this.addTrailers(trailers)
    if (!empty) this.#tap.add(body)
    if (this.open) this.response.end(empty ? undefined : body)
  }

  /**
   * A streamed answer: status and headers now, the body as `source` gives it, then the trailers
   * `trailers()` gives once it has ended. A gRPC answer's `grpc-status` headers go with them,
   * unless the trailers name their own. The source stops when the client goes away; one that fails
   * resets the stream.
   */
  stream(
    status: number,
    pairs: readonly (readonly [string, string])[],
    source: Readable,
    trailers: () => Promise<readonly (readonly [string, string])[]>,
  ): void {
    const headers = pairs.filter(([name]) => !isFraming(name))
    const grpc = grpcStatusOf(headers)

    this.head(
      status,
      headers.filter((pair) => !grpc.includes(pair)),
      undefined,
      "trailers",
    )
    source.on("data", (chunk: Buffer) => this.#tap.add(chunk))
    source.once("error", () => this.response.destroy())
    this.response.once("close", () => source.destroy())
    source.once("end", () => {
      trailers().then(
        (own) => {
          const named = new Set(own.map(([name]) => name.toLowerCase()))

          this.addTrailers([...grpc.filter(([name]) => !named.has(name.toLowerCase())), ...own])
          if (this.open) this.response.end()
        },
        () => this.response.destroy(),
      )
    })
    source.pipe(this.response, { end: false })
  }

  /** Streams `source` out as the body, keeping what passes for the record. */
  pipeFrom(source: Readable): void {
    source.on("data", (chunk: Buffer) => this.#tap.add(chunk))
    source.pipe(this.response)
  }

  /** Trailers to send once the body has gone. */
  addTrailers(pairs: readonly (readonly [string, string])[]): void {
    if (this.response instanceof H2Response) this.response.addTrailers(pairs)
    else this.response.addTrailers(pairs.map(([name, value]): [string, string] => [name, value]))
  }

  /**
   * Drops the response before it is answered or partway through. An HTTP/2 stream is reset alone
   * (with `code`, else as a server that failed), so the client's other streams carry on; an
   * HTTP/1.x response's connection is dropped through `drop`.
   */
  reset(drop: (socket: Duplex) => void, code?: number): void {
    if (this.response instanceof H2Response) {
      this.response.reset(code)

      return
    }

    const { socket } = this.response

    if (socket === null) this.response.destroy()
    else drop(socket)
  }
}
