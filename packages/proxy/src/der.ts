/**
 * The handful of ASN.1 DER encodings an X.509 certificate needs: each value is its tag, its length
 * and its content, nested. Only encoding, never parsing: Node reads certificates itself.
 */

/** A DER length: one byte below 128, else a byte that says how many big-endian bytes follow. */
function lengthOf(length: number): Buffer {
  if (length < 0x80) return Buffer.from([length])

  const bytes: number[] = []

  for (let left = length; left > 0; left = Math.floor(left / 256)) bytes.unshift(left % 256)

  return Buffer.from([0x80 | bytes.length, ...bytes])
}

/** One value with tag `tag` and the given content. */
function tagged(tag: number, content: Uint8Array): Buffer {
  return Buffer.concat([Buffer.from([tag]), lengthOf(content.length), content])
}

export function sequence(...items: readonly Uint8Array[]): Buffer {
  return tagged(0x30, Buffer.concat(items))
}

export function set(...items: readonly Uint8Array[]): Buffer {
  return tagged(0x31, Buffer.concat(items))
}

/**
 * A non-negative INTEGER from its big-endian bytes: leading zeros dropped, and one zero byte added
 * back when the top bit is set, so it does not read as negative.
 */
export function unsignedInteger(bytes: Uint8Array): Buffer {
  let start = 0

  while (start < bytes.length - 1 && bytes[start] === 0) start++

  const trimmed = bytes.subarray(start)
  const padded = (trimmed[0] ?? 0) & 0x80 ? Buffer.concat([Buffer.from([0]), trimmed]) : trimmed

  return tagged(0x02, padded.length === 0 ? Buffer.from([0]) : padded)
}

/** A small non-negative INTEGER. */
export function smallInteger(value: number): Buffer {
  return unsignedInteger(Buffer.from([value]))
}

/** An OBJECT IDENTIFIER from its dotted form, `2.5.29.17`. */
export function oid(dotted: string): Buffer {
  const [first = 0, second = 0, ...rest] = dotted.split(".").map(Number)
  const bytes = [first * 40 + second]

  for (const arc of rest) {
    const groups = [arc % 128]

    for (let left = Math.floor(arc / 128); left > 0; left = Math.floor(left / 128))
      groups.unshift(0x80 | (left % 128))

    bytes.push(...groups)
  }

  return tagged(0x06, Buffer.from(bytes))
}

export const NULL = Buffer.from([0x05, 0x00])

export function boolean(value: boolean): Buffer {
  return tagged(0x01, Buffer.from([value ? 0xff : 0x00]))
}

export function octetString(content: Uint8Array): Buffer {
  return tagged(0x04, content)
}

/** A BIT STRING whose last `unusedBits` bits are padding. */
export function bitString(content: Uint8Array, unusedBits = 0): Buffer {
  return tagged(0x03, Buffer.concat([Buffer.from([unusedBits]), content]))
}

export function utf8String(text: string): Buffer {
  return tagged(0x0c, Buffer.from(text, "utf8"))
}

/** `[n]` wrapping a whole encoded value (EXPLICIT tagging). */
export function explicit(n: number, value: Uint8Array): Buffer {
  return tagged(0xa0 + n, value)
}

/** `[n]` in place of a primitive value's own tag (IMPLICIT tagging), around its bare content. */
export function implicit(n: number, content: Uint8Array): Buffer {
  return tagged(0x80 + n, content)
}

/**
 * A certificate's time: UTCTime (`YYMMDDHHMMSSZ`) for the years 1950 to 2049, as the profile asks,
 * GeneralizedTime (`YYYYMMDDHHMMSSZ`) outside them.
 */
export function time(date: Date): Buffer {
  const iso = date.toISOString()
  const digits = `${iso.slice(0, 4)}${iso.slice(5, 7)}${iso.slice(8, 10)}${iso.slice(11, 13)}${iso.slice(14, 16)}${iso.slice(17, 19)}Z`
  const year = date.getUTCFullYear()

  return year >= 1950 && year < 2050
    ? tagged(0x17, Buffer.from(digits.slice(2), "ascii"))
    : tagged(0x18, Buffer.from(digits, "ascii"))
}
