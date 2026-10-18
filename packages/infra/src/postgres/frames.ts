/**
 * Postgres frontend/backend messages: cutting a byte stream into whole messages, reading the few
 * fields the proxy needs, and building the messages it answers with itself.
 */

/** One whole message: its type byte (empty for the untyped startup messages), body and bytes. */
export interface PgMessage {
  readonly type: string
  readonly body: Buffer
  readonly raw: Buffer
}

/** Startup request codes, in the place a startup message has its protocol version. */
export const SSL_REQUEST = 80877103
export const GSSENC_REQUEST = 80877104
export const CANCEL_REQUEST = 80877102

/**
 * Cuts a stream into messages. Typed messages are a type byte and a length that counts itself;
 * the first messages a client sends (startup, SSL request) have no type byte, so the reader can
 * switch `typed` between two messages.
 */
export class Framer {
  #buffer: Buffer = Buffer.alloc(0)
  typed: boolean

  constructor(typed: boolean) {
    this.typed = typed
  }

  /** Adds bytes from the stream. */
  feed(bytes: Buffer): void {
    this.#buffer = this.#buffer.length === 0 ? bytes : Buffer.concat([this.#buffer, bytes])
  }

  /** The next whole message, or undefined until more bytes come. */
  next(): PgMessage | undefined {
    const head = this.typed ? 5 : 4

    if (this.#buffer.length < head) return undefined

    const length = this.#buffer.readInt32BE(this.typed ? 1 : 0)
    const total = this.typed ? length + 1 : length

    if (this.#buffer.length < total) return undefined

    const raw = this.#buffer.subarray(0, total)

    this.#buffer = this.#buffer.subarray(total)

    return {
      type: this.typed ? String.fromCharCode(raw[0] ?? 0) : "",
      body: raw.subarray(head),
      raw,
    }
  }
}

/** The null-terminated strings at the start of `body`, up to `count` of them. */
export function cStrings(body: Buffer, count: number): string[] {
  const strings: string[] = []
  let at = 0

  while (strings.length < count && at < body.length) {
    const end = body.indexOf(0, at)

    if (end < 0) break
    strings.push(body.toString("utf8", at, end))
    at = end + 1
  }

  return strings
}

/** An ErrorResponse's or NoticeResponse's fields by their one-letter codes. */
export function errorFields(body: Buffer): Map<string, string> {
  const fields = new Map<string, string>()
  let at = 0

  while (at < body.length && body[at] !== 0) {
    const code = String.fromCharCode(body[at] ?? 0)
    const end = body.indexOf(0, at + 1)

    if (end < 0) break
    fields.set(code, body.toString("utf8", at + 1, end))
    at = end + 1
  }

  return fields
}

/** A typed message with `type` and `body`. */
function frame(type: string, body: Buffer): Buffer {
  const head = Buffer.alloc(5)

  head.write(type, 0, "latin1")
  head.writeInt32BE(body.length + 4, 1)

  return Buffer.concat([head, body])
}

/** An ErrorResponse with severity, SQLSTATE and message. */
export function errorResponse(severity: "ERROR" | "FATAL", code: string, message: string): Buffer {
  const fields = [`S${severity}`, `V${severity}`, `C${code}`, `M${message}`]

  return frame(
    "E",
    Buffer.concat([...fields.map((field) => Buffer.from(`${field}\0`)), Buffer.from([0])]),
  )
}

/** A ReadyForQuery saying whether a transaction is open: `I` idle, `T` in one, `E` in a failed one. */
export function readyForQuery(status: "I" | "T" | "E"): Buffer {
  return frame("Z", Buffer.from(status, "latin1"))
}

/** A simple Query message. */
export function query(sql: string): Buffer {
  return frame("Q", Buffer.from(`${sql}\0`))
}
