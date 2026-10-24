/**
 * Message bodies as the proxy holds them: read whole for a route's handler, kept up to a bound for
 * the flight recorder while a passed-through body streams on, and decoded from the
 * `Content-Encoding` a client or server compressed them with.
 */
import type { Readable } from "node:stream"
import { promisify } from "node:util"
import * as zlib from "node:zlib"

/**
 * The most of one body an exchange's record holds in memory. A body past it is still passed on
 * whole and counted, but the record keeps only its start, as it keeps only the start of any text.
 */
const CAPTURE_LIMIT_BYTES = 8 * 1024 * 1024

/** The most a compressed body may grow to when decoded: a body that would grow past it stays encoded. */
const MAX_DECODED_BYTES = 256 * 1024 * 1024

type Decoder = (input: Buffer, options: zlib.ZlibOptions) => Promise<Buffer>

const gunzip: Decoder = promisify(zlib.gunzip)
const inflate: Decoder = promisify(zlib.inflate)
const inflateRaw: Decoder = promisify(zlib.inflateRaw)
const brotli: (input: Buffer, options: zlib.BrotliOptions) => Promise<Buffer> = promisify(
  zlib.brotliDecompress,
)
/** zstd is in zlib on every Node danwo runs on (22.15 and later). */
const zstd: (input: Buffer, options: zlib.ZstdOptions) => Promise<Buffer> = promisify(
  zlib.zstdDecompress,
)

/** Undoes one coding; undefined for a coding this proxy does not know. */
async function undo(coding: string, input: Buffer): Promise<Buffer | undefined> {
  const options = { maxOutputLength: MAX_DECODED_BYTES }

  switch (coding) {
    case "identity":
      return input
    case "gzip":
    case "x-gzip":
      return gunzip(input, options)
    /* `deflate` is meant to be zlib-wrapped, but some servers send it raw. */
    case "deflate":
      return inflate(input, options).catch(() => inflateRaw(input, options))
    case "br":
      return brotli(input, options)
    case "zstd":
      return zstd(input, options)
    default:
      return undefined
  }
}

/**
 * `bytes` with every coding in `encoding` (a `Content-Encoding` value, codings applied in order)
 * undone, last first. Undefined when one of them is unknown, such as S3's `aws-chunked`, or the
 * body does not decode: the caller keeps the bytes as they came, with their header.
 */
export async function decodeBody(
  bytes: Buffer,
  encoding: string | undefined,
): Promise<Buffer | undefined> {
  const codings = (encoding ?? "")
    .split(",")
    .map((coding) => coding.trim().toLowerCase())
    .filter(Boolean)

  if (codings.length === 0 || bytes.length === 0) return bytes

  let out: Buffer | undefined = bytes

  for (const coding of codings.toReversed()) {
    if (out === undefined) return undefined
    out = await undo(coding, out).catch(() => undefined)
  }

  return out
}

/** The bytes of a stream that pass by, kept up to `limit`, and how many there were in all. */
export class BodyTap {
  readonly #chunks: Buffer[] = []
  #kept = 0
  #total = 0
  readonly limit: number

  constructor(limit = CAPTURE_LIMIT_BYTES) {
    this.limit = limit
  }

  add(chunk: Buffer): void {
    this.#total += chunk.length
    if (this.#kept >= this.limit) return

    const part = chunk.subarray(0, this.limit - this.#kept)

    this.#chunks.push(part)
    this.#kept += part.length
  }

  /** The bytes kept, and the whole body's size. */
  get body(): { readonly bytes: Buffer; readonly total: number } {
    return { bytes: Buffer.concat(this.#chunks), total: this.#total }
  }
}

/** All of `stream`'s bytes, once it ends. */
export async function readAll(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = []

  for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))

  return Buffer.concat(chunks)
}
