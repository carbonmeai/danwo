import { createHmac } from "node:crypto"

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"

/** The bytes a base32 secret (as authenticator apps take it) stands for. */
function base32Bytes(secret: string): Buffer {
  let bits = ""

  for (const char of secret.toUpperCase().replace(/[\s=]/g, "")) {
    const value = BASE32.indexOf(char)

    if (value < 0) throw new RangeError("the TOTP secret is not base32")
    bits += value.toString(2).padStart(5, "0")
  }

  const bytes = bits.match(/.{8}/g) ?? []

  return Buffer.from(bytes.map((byte) => Number.parseInt(byte, 2)))
}

/** The six-digit code for the 30-second step `counter`. */
function codeAt(key: Buffer, counter: number): string {
  const message = Buffer.alloc(8)

  message.writeBigUInt64BE(BigInt(counter))

  const digest = createHmac("sha1", key).update(message).digest()
  const offset = (digest.at(-1) ?? 0) & 0x0f
  const binary = digest.readUInt32BE(offset) & 0x7fffffff

  return String(binary % 1_000_000).padStart(6, "0")
}

const stepOf = (time: Date) => Math.floor(time.getTime() / 30_000)

/** The one-time code an authenticator app shows for `secret` at `time`. */
export function otpAt(secret: string, time: Date): string {
  return codeAt(base32Bytes(secret), stepOf(time))
}

/** Whether `code` is the current one-time code for `secret`, allowing one step of clock drift. */
export function otpMatches(secret: string, code: string, now: Date): boolean {
  const key = base32Bytes(secret)
  const step = stepOf(now)

  return [step - 1, step, step + 1].some((counter) => codeAt(key, counter) === code.trim())
}
