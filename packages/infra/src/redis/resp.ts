/**
 * Cutting a Redis byte stream into whole RESP values without decoding all of them: commands from
 * the client (arrays of bulk strings, or inline lines) and replies from the server (RESP2 and
 * RESP3, including push messages that answer no command).
 */

/** One whole value: its bytes, its type byte, and, for a command, its words. */
export interface RespValue {
  readonly raw: Buffer
  readonly type: string
  /** A command's name and arguments (only read for arrays of strings and inline commands). */
  readonly words: readonly string[]
  /** An error reply's text (`OOM command not allowed…`), for `-` and `!` values. */
  readonly error?: string
}

const CRLF = "\r\n"

/** Types whose value is the rest of their line. */
const LINES = new Set(["+", "-", ":", "_", ",", "#", "("])
/** Types with a length, then that many bytes and a CRLF. */
const BULKS = new Set(["$", "!", "="])
/** Types with a count, then that many values (twice as many for maps and attributes). */
const AGGREGATES = new Map([
  ["*", 1],
  ["~", 1],
  [">", 1],
  ["%", 2],
  ["|", 2],
])

/** The end of the value starting at `at` (exclusive), or undefined while it is incomplete. */
function endOf(buffer: Buffer, at: number): number | undefined {
  const lineEnd = buffer.indexOf(CRLF, at)

  if (lineEnd < 0) return undefined

  const type = String.fromCharCode(buffer[at] ?? 0)
  const count = Number(buffer.toString("latin1", at + 1, lineEnd))

  if (BULKS.has(type)) return bulkEnd(buffer, lineEnd, count)

  const multiplier = AGGREGATES.get(type)

  if (multiplier === undefined) return lineEnd + 2

  const end = itemsEnd(buffer, lineEnd + 2, count * multiplier)

  return type === "|" && end !== undefined ? endOf(buffer, end) : end
}

/** The end of `count` values from `from`: an aggregate's items, or an attribute's pairs. */
function itemsEnd(buffer: Buffer, from: number, count: number): number | undefined {
  let next: number | undefined = from

  for (let item = 0; item < count && next !== undefined; item++) next = endOf(buffer, next)

  return next
}

function bulkEnd(buffer: Buffer, lineEnd: number, length: number): number | undefined {
  if (length < 0) return lineEnd + 2

  const end = lineEnd + 2 + length + 2

  return buffer.length >= end ? end : undefined
}

/** The strings of an array of bulk strings, as a command sends them. */
function arrayWords(raw: Buffer): string[] {
  const words: string[] = []
  let at = raw.indexOf(CRLF) + 2

  while (at < raw.length && raw[at] === 36) {
    const lineEnd = raw.indexOf(CRLF, at)
    const length = Number(raw.toString("latin1", at + 1, lineEnd))

    words.push(raw.toString("utf8", lineEnd + 2, lineEnd + 2 + Math.max(0, length)))
    at = lineEnd + 2 + Math.max(0, length) + 2
  }

  return words
}

/** Reads whole values off a stream. `commands` reads the client side, where inline commands exist. */
export class RespReader {
  #buffer: Buffer = Buffer.alloc(0)
  readonly commands: boolean

  constructor(commands: boolean) {
    this.commands = commands
  }

  feed(bytes: Buffer): void {
    this.#buffer = this.#buffer.length === 0 ? bytes : Buffer.concat([this.#buffer, bytes])
  }

  next(): RespValue | undefined {
    if (this.#buffer.length === 0) return undefined

    const type = String.fromCharCode(this.#buffer[0] ?? 0)
    const inline = this.commands && !AGGREGATES.has(type) && !BULKS.has(type) && !LINES.has(type)
    const end = inline ? this.#inlineEnd() : endOf(this.#buffer, 0)

    if (end === undefined) return undefined

    const raw = this.#buffer.subarray(0, end)

    this.#buffer = this.#buffer.subarray(end)

    return valueOf(raw, type, inline)
  }

  #inlineEnd(): number | undefined {
    const lineEnd = this.#buffer.indexOf("\n")

    return lineEnd < 0 ? undefined : lineEnd + 1
  }
}

function valueOf(raw: Buffer, type: string, inline: boolean): RespValue {
  if (inline) return { raw, type: "inline", words: raw.toString("utf8").trim().split(/\s+/) }
  if (type === "*") return { raw, type, words: arrayWords(raw) }
  if (type === "-") return { raw, type, words: [], error: raw.toString("utf8", 1, raw.length - 2) }

  return { raw, type, words: [] }
}

/** A RESP error reply: `-OOM command not allowed…`. */
export function errorReply(code: string, message: string): Buffer {
  return Buffer.from(`-${code} ${message}${CRLF}`)
}
