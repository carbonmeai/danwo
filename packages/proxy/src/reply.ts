/**
 * Writing a response back to the client, and keeping what was written for the flight recorder:
 * its status, headers as sent, and body (up to a bound). The record hears when the response has
 * gone out, or that the client went away before it had.
 */
import {
  type OutgoingHttpHeader,
  type ServerResponse,
  validateHeaderName,
  validateHeaderValue,
} from "node:http"
import type { Readable } from "node:stream"

import { BodyTap } from "./bodies.ts"

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

/** Whether a header says how the body is framed, which the proxy sets itself. */
function isFraming(name: string): boolean {
  return name.toLowerCase() === "content-length" || name.toLowerCase() === "transfer-encoding"
}

/** One response to one client, written through here so the record sees what was sent. */
export class Reply {
  readonly response: ServerResponse
  readonly #events: ReplyEvents
  readonly #tap = new BodyTap()
  #status = 0
  #headers: HeaderRecord = {}

  constructor(response: ServerResponse, events: ReplyEvents) {
    this.response = response
    this.#events = events
    /* The headers a response goes out with are the ones it was given, and no others. */
    response.sendDate = false
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
   * refuse is left out, and a status message it would refuse is replaced by the standard one.
   */
  head(status: number, pairs: readonly (readonly [string, string])[], message?: string): void {
    if (!this.open || this.headSent) return

    const kept = pairs.filter(([name, value]) => isWritableHeader(name, value))
    const flat: OutgoingHttpHeader[] = kept.flat()

    this.#status = status
    this.#headers = recordOf(kept)

    try {
      if (message === undefined) this.response.writeHead(status, flat)
      else this.response.writeHead(status, message, flat)
    } catch {
      this.response.writeHead(status, flat)
    }

    this.#events.head(status, this.#headers)
  }

  /** A whole response: status, headers and body, with `Content-Length` set from the body. */
  send(
    status: number,
    pairs: readonly (readonly [string, string])[],
    body: Buffer,
    method: string,
  ): void {
    const empty = hasNoBody(status, method)
    /* A response with no body keeps the length it says it would have had (a HEAD's). */
    const headers = empty
      ? pairs.filter(([name]) => name.toLowerCase() !== "transfer-encoding")
      : [
          ...pairs.filter(([name]) => !isFraming(name)),
          ["content-length", String(body.length)] as const,
        ]

    this.head(status, headers)
    if (!empty) this.#tap.add(body)
    if (this.open) this.response.end(empty ? undefined : body)
  }

  /** Streams `source` out as the body, keeping what passes for the record. */
  pipeFrom(source: Readable): void {
    source.on("data", (chunk: Buffer) => this.#tap.add(chunk))
    source.pipe(this.response)
  }
}
