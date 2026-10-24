/**
 * gRPC calls a route's handler answers as streams. Every other call reaches its handler with its
 * body read whole and is answered whole; a gRPC call over HTTP/2 reaches it with its body as a
 * stream, as the client sends it, and is answered as the handler's response streams, so a handler
 * can emulate a two-way stream: read a message, answer it, read the next. Its trailers, such as
 * `grpc-status`, can wait until its stream has ended: {@link withTrailers}.
 */
import { PassThrough, type Readable } from "node:stream"

import { BodyTap } from "./bodies.ts"
import type { Incoming } from "./listener.ts"
import type { TappedBody } from "./reply.ts"

/** Whether a call's body streams to its handler and its answer streams back: gRPC over HTTP/2. */
export function isStreamedCall(incoming: Incoming): boolean {
  const type = incoming.headers["content-type"]
  const first = typeof type === "string" ? type : type?.[0]

  return incoming.httpVersion === "2" && /^application\/grpc(?:\+|;|$)/i.test(first?.trim() ?? "")
}

/**
 * The call's body as its handler will read it, held back until it does, and kept for the record
 * as it passes: `recorded` gets it once it has all arrived.
 */
export function streamedBody(incoming: Incoming, recorded: (body: TappedBody) => void): Readable {
  const tap = new BodyTap()
  const body = new PassThrough()

  incoming.message.on("data", (chunk: Buffer) => tap.add(chunk))
  incoming.message.once("end", () => recorded(tap.body))
  incoming.message.pipe(body)

  return body
}

/** `body` as a web stream, read from only as its reader asks. */
function webStream(body: Readable): ReadableStream<Uint8Array> {
  const chunks = body[Symbol.asyncIterator]()

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const next: IteratorResult<unknown> = await chunks.next()

      if (next.done === true) controller.close()
      else if (Buffer.isBuffer(next.value)) controller.enqueue(new Uint8Array(next.value))
    },
    async cancel() {
      await chunks.return?.()
    },
  })
}

/** A `Request` whose body is `body`, read as the handler reads it. */
export function streamedRequest(
  url: string,
  init: { readonly method: string; readonly headers: Headers },
  body: Readable,
): Request {
  /* Node's fetch takes a streamed body only with `duplex`, which the DOM's types do not name. */
  const streaming: RequestInit & { readonly duplex: "half" } = {
    ...init,
    body: webStream(body),
    duplex: "half",
  }

  return new Request(url, streaming)
}

type TrailerSource = () => HeadersInit | Promise<HeadersInit>

/**
 * Where a response keeps its trailers: a registered symbol, so a package that answers calls (an
 * emulator) can attach them without depending on this one.
 */
const TRAILERS = Symbol.for("danwo.trailers")

/**
 * `response`, with trailers to send once its body has all gone, asked for only then: a gRPC
 * answer's `grpc-status` and `grpc-message`, decided as its stream of messages ends. A client
 * calling over HTTP/2 gets them. Without any, a gRPC answer's `grpc-status` headers are sent as
 * its trailers.
 */
export function withTrailers(response: Response, trailers: TrailerSource): Response {
  Object.defineProperty(response, TRAILERS, { value: trailers })

  return response
}

function isTrailerSource(value: unknown): value is TrailerSource {
  return typeof value === "function"
}

/** The trailers `withTrailers` gave `response`, as name and value pairs; none when it gave none. */
export function trailersOf(response: Response): () => Promise<[string, string][]> {
  const source: unknown = Reflect.get(response, TRAILERS)

  return async () => (isTrailerSource(source) ? [...new Headers(await source())] : [])
}
