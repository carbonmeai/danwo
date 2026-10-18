/**
 * The file name Android gives a CA in its trust stores: the OpenSSL "old" subject hash of the
 * certificate (the MD5 of its subject name, first four bytes read little-endian), plus `.0`. Worked
 * out here from the certificate itself, so binding a device needs no openssl.
 */
import { createHash, X509Certificate } from "node:crypto"

/** One DER element: where its content starts and ends in the buffer. */
interface Element {
  readonly start: number
  readonly contentStart: number
  readonly end: number
  readonly tag: number
}

/** The DER element at `offset`. */
function element(der: Buffer, offset: number): Element {
  const tag = der[offset] ?? 0
  const first = der[offset + 1] ?? 0

  if (first < 0x80) return { start: offset, contentStart: offset + 2, end: offset + 2 + first, tag }

  const lengthBytes = first & 0x7f
  let length = 0

  for (let i = 0; i < lengthBytes; i++) length = length * 256 + (der[offset + 2 + i] ?? 0)

  const contentStart = offset + 2 + lengthBytes

  return { start: offset, contentStart, end: contentStart + length, tag }
}

/** The elements directly inside `parent`. */
function children(der: Buffer, parent: Element): Element[] {
  const found: Element[] = []

  for (let offset = parent.contentStart; offset < parent.end;) {
    const child = element(der, offset)

    found.push(child)
    offset = child.end
  }

  return found
}

/** The DER of a certificate's subject name. */
export function subjectDer(pem: string): Buffer {
  const der = new X509Certificate(pem).raw
  const tbs = children(der, element(der, 0))[0]

  if (tbs === undefined) throw new Error("not a certificate: no tbsCertificate")

  const fields = children(der, tbs)
  /* An explicit version ([0]) comes first when present; the subject is the fifth field after it. */
  const offset = fields[0]?.tag === 0xa0 ? 1 : 0
  const subject = fields[offset + 4]

  if (subject === undefined) throw new Error("not a certificate: no subject")

  return der.subarray(subject.start, subject.end)
}

/** The name Android's CA stores file `pem` under, e.g. `e0fa6ee6.0`. */
export function androidCaFileName(pem: string): string {
  const digest = createHash("md5").update(subjectDer(pem)).digest()

  return `${digest.readUInt32LE(0).toString(16).padStart(8, "0")}.0`
}
