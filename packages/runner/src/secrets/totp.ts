/**
 * Time-based one-time codes (RFC 6238), as authenticator apps make them: an HMAC of the number of
 * periods since the Unix epoch, under a shared key the app shows as a base32 string, cut down to
 * a few digits (RFC 4226). A `totp` secret holds that key; each time it is typed, the code for that
 * moment is made from it.
 */
import { createHmac } from "node:crypto"

/** How codes are made from the key: their length, how long each lasts, and the HMAC's hash. */
export interface TotpSettings {
  readonly digits?: 6 | 7 | 8
  /** Seconds a code is valid for. Default 30. */
  readonly period?: number
  readonly algorithm?: "sha1" | "sha256" | "sha512"
}

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"

/** The bytes a base32 key stands for; spaces, dashes and padding are ignored, case too. */
export function base32Bytes(key: string): Buffer {
  const clean = key.toUpperCase().replace(/[\s=-]/g, "")
  const bytes: number[] = []
  let bits = 0
  let buffer = 0

  for (const char of clean) {
    const value = BASE32.indexOf(char)

    if (value < 0) throw new Error(`"${char}" is not a base32 character`)

    buffer = (buffer << 5) | value
    bits += 5

    if (bits >= 8) {
      bits -= 8
      bytes.push((buffer >> bits) & 0xff)
    }
  }

  return Buffer.from(bytes)
}

/** The counter as the 8 big-endian bytes the HMAC is taken over. */
function counterBytes(counter: number): Buffer {
  const bytes = Buffer.alloc(8)

  bytes.writeBigUInt64BE(BigInt(counter))

  return bytes
}

/** The one-time code for `counter` under `secret` (RFC 4226). */
function hotp(secret: Buffer, counter: number, settings: TotpSettings = {}): string {
  const digits = settings.digits ?? 6
  const mac = createHmac(settings.algorithm ?? "sha1", secret)
    .update(counterBytes(counter))
    .digest()
  const offset = (mac.at(-1) ?? 0) & 0x0f
  const code = mac.readUInt32BE(offset) & 0x7fffffff

  return String(code % 10 ** digits).padStart(digits, "0")
}

/** The time-based code for the base32 `key` at `atMs` (default now). */
export function totp(key: string, settings: TotpSettings = {}, atMs = Date.now()): string {
  const period = settings.period ?? 30

  return hotp(base32Bytes(key), Math.floor(atMs / 1000 / period), settings)
}
