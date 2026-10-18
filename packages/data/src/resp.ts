/**
 * The smallest Redis client the snapshot needs: commands go out as RESP arrays of bulk strings
 * and replies come back as strings, buffers, numbers, arrays or errors, in order. Bulk replies
 * stay buffers, since `DUMP` payloads are binary.
 */
import { connect, type Socket } from "node:net"

export type Reply = Buffer | string | number | null | readonly Reply[]

interface Waiting {
  readonly resolve: (reply: Reply) => void
  readonly reject: (error: Error) => void
}

/** One parsed reply and where the next one starts, or undefined when more bytes are needed. */
type Parsed = { readonly reply: Reply | Error; readonly next: number } | undefined

function lineEnd(buffer: Buffer, from: number): number {
  return buffer.indexOf("\r\n", from)
}

function parseBulk(buffer: Buffer, end: number, length: number): Parsed {
  if (length < 0) return { reply: null, next: end + 2 }

  const stop = end + 2 + length

  if (buffer.length < stop + 2) return undefined

  return { reply: buffer.subarray(end + 2, stop), next: stop + 2 }
}

function parseArray(buffer: Buffer, end: number, count: number): Parsed {
  if (count < 0) return { reply: null, next: end + 2 }

  const items: Reply[] = []
  let at = end + 2

  for (let i = 0; i < count; i++) {
    const item = parse(buffer, at)

    if (!item) return undefined
    if (item.reply instanceof Error) return item
    items.push(item.reply)
    at = item.next
  }

  return { reply: items, next: at }
}

function parse(buffer: Buffer, start: number): Parsed {
  const end = lineEnd(buffer, start)

  if (end < 0) return undefined

  const head = buffer.toString("utf8", start + 1, end)

  switch (String.fromCodePoint(buffer[start] ?? 0)) {
    case "+":
      return { reply: head, next: end + 2 }
    case "-":
      return { reply: new Error(head), next: end + 2 }
    case ":":
      return { reply: Number(head), next: end + 2 }
    case "$":
      return parseBulk(buffer, end, Number(head))
    case "*":
      return parseArray(buffer, end, Number(head))
    default:
      return { reply: new Error(`unexpected reply: ${head}`), next: end + 2 }
  }
}

/** A command as RESP. */
function encode(args: readonly (string | Buffer)[]): Buffer {
  const parts = args.flatMap((arg) => {
    const bytes = typeof arg === "string" ? Buffer.from(arg) : arg

    return [Buffer.from(`$${bytes.length}\r\n`), bytes, Buffer.from("\r\n")]
  })

  return Buffer.concat([Buffer.from(`*${args.length}\r\n`), ...parts])
}

export class RespClient {
  readonly #socket: Socket
  readonly #waiting: Waiting[] = []
  #buffer = Buffer.alloc(0)

  private constructor(socket: Socket) {
    this.#socket = socket
    socket.on("data", (chunk: Buffer) => this.#read(chunk))
    socket.on("error", (error) => this.#failAll(error))
    socket.on("close", () => this.#failAll(new Error("the connection to Redis closed")))
  }

  /** Connects to a `redis://` URL, authenticating with its password when it has one. */
  static async open(url: string): Promise<RespClient> {
    const target = new URL(url)
    const socket = connect(Number(target.port || 6379), target.hostname)

    await new Promise<void>((resolve, reject) => {
      socket.once("connect", resolve)
      socket.once("error", reject)
    })

    const client = new RespClient(socket)
    const password = decodeURIComponent(target.password)

    if (password !== "") {
      const user = decodeURIComponent(target.username)

      await client.call(...(user === "" ? ["AUTH", password] : ["AUTH", user, password]))
    }

    return client
  }

  call(...args: (string | Buffer)[]): Promise<Reply> {
    return new Promise((resolve, reject) => {
      this.#waiting.push({ resolve, reject })
      this.#socket.write(encode(args))
    })
  }

  // fallow-ignore-next-line unused-class-member -- called on the client a promise resolves to
  close(): void {
    this.#socket.end()
  }

  #read(chunk: Buffer): void {
    this.#buffer = Buffer.concat([this.#buffer, chunk])

    for (;;) {
      const parsed = parse(this.#buffer, 0)

      if (!parsed) return
      this.#buffer = this.#buffer.subarray(parsed.next)
      this.#settle(parsed.reply)
    }
  }

  #settle(reply: Reply | Error): void {
    const waiting = this.#waiting.shift()

    if (reply instanceof Error) waiting?.reject(reply)
    else waiting?.resolve(reply)
  }

  #failAll(error: Error): void {
    for (const waiting of this.#waiting.splice(0)) waiting.reject(error)
  }
}
