/**
 * The proxy's certificate authority: a key pair and a self-signed CA certificate made for one
 * proxy, and a certificate it signs for each host a client opens TLS to, so a client that trusts
 * the CA accepts the proxy as that host. Nothing here is written to disk but the CA certificate,
 * by the caller; the CA's private key lives only in memory, for as long as the proxy runs.
 */
import {
  createHash,
  generateKeyPair,
  type KeyObject,
  randomBytes,
  sign,
  X509Certificate,
} from "node:crypto"
import { isIP } from "node:net"
import { createSecureContext, type SecureContext } from "node:tls"
import { promisify } from "node:util"

import {
  bitString,
  boolean,
  explicit,
  implicit,
  NULL,
  octetString,
  oid,
  sequence,
  set,
  smallInteger,
  time,
  unsignedInteger,
  utf8String,
} from "./der.ts"

const generateRsa = promisify(generateKeyPair)

const DAY_MS = 24 * 60 * 60 * 1000
/** How far back a certificate's validity starts, so a client whose clock runs slow still takes it. */
const BACKDATE_MS = DAY_MS
/** A CA lives for one run; a year covers any run. */
const CA_LIFETIME_MS = 365 * DAY_MS
/**
 * A host's certificate: well under the 398 days Apple's TLS stack accepts for a server
 * certificate, and minted again when fewer than a day remain.
 */
const LEAF_LIFETIME_MS = 30 * DAY_MS
/** The longest common name a certificate may carry; a longer hostname goes in the SAN alone. */
const MAX_COMMON_NAME = 64

const OIDS = {
  sha256WithRsa: "1.2.840.113549.1.1.11",
  commonName: "2.5.4.3",
  organization: "2.5.4.10",
  subjectKeyId: "2.5.29.14",
  keyUsage: "2.5.29.15",
  subjectAltName: "2.5.29.17",
  basicConstraints: "2.5.29.19",
  authorityKeyId: "2.5.29.35",
  extendedKeyUsage: "2.5.29.37",
  serverAuth: "1.3.6.1.5.5.7.3.1",
} as const

/** RSA keys: every TLS client there is takes them. */
async function rsaKeyPair(): Promise<{ publicKey: KeyObject; privateKey: KeyObject }> {
  return generateRsa("rsa", { modulusLength: 2048 })
}

/**
 * One key pair for every host's certificate in this process, made the first time one is needed.
 * A key per certificate would cost a key generation per host for no gain here: whoever could take
 * this key could take the CA's too.
 */
let leafKeys: Promise<{ publicKey: KeyObject; privateKey: KeyObject }> | undefined

function sharedLeafKeys() {
  leafKeys ??= rsaKeyPair()

  return leafKeys
}

function pem(der: Uint8Array, label: string): string {
  const lines =
    Buffer.from(der)
      .toString("base64")
      .match(/.{1,64}/g) ?? []

  return `-----BEGIN ${label}-----\n${lines.join("\n")}\n-----END ${label}-----\n`
}

function name(parts: readonly (readonly [string, string])[]): Buffer {
  return sequence(...parts.map(([type, value]) => set(sequence(oid(type), utf8String(value)))))
}

function extension(id: string, critical: boolean, value: Uint8Array): Buffer {
  return sequence(oid(id), ...(critical ? [boolean(true)] : []), octetString(value))
}

/** A 16-byte serial with its top bit clear, so it stays positive and its length fixed. */
function serialNumber(): Buffer {
  const bytes = randomBytes(16)

  bytes[0] = (bytes[0] ?? 0) & 0x7f || 0x01

  return unsignedInteger(bytes)
}

const SIGNATURE_ALGORITHM = sequence(oid(OIDS.sha256WithRsa), NULL)

interface Draft {
  readonly issuer: Buffer
  readonly subject: Buffer
  readonly publicKey: KeyObject
  readonly notBefore: Date
  readonly notAfter: Date
  readonly extensions: readonly Buffer[]
}

/** The DER certificate for `draft`, signed with `signingKey`. */
function signCertificate(draft: Draft, signingKey: KeyObject): Buffer {
  const tbs = sequence(
    explicit(0, smallInteger(2)),
    serialNumber(),
    SIGNATURE_ALGORITHM,
    draft.issuer,
    sequence(time(draft.notBefore), time(draft.notAfter)),
    draft.subject,
    draft.publicKey.export({ type: "spki", format: "der" }),
    explicit(3, sequence(...draft.extensions)),
  )

  return sequence(tbs, SIGNATURE_ALGORITHM, bitString(sign("sha256", tbs, signingKey)))
}

/** A key's identifier: the SHA-1 of its SubjectPublicKeyInfo. */
function keyIdentifier(publicKey: KeyObject): Buffer {
  return createHash("sha1")
    .update(publicKey.export({ type: "spki", format: "der" }))
    .digest()
}

/** The 16-bit words of one side of an IPv6 address's `::`, an IPv4 tail as two of them. */
function words(part: string | undefined): number[] {
  return (part ?? "")
    .split(":")
    .filter(Boolean)
    .flatMap((group) => {
      if (!group.includes(".")) return [Number.parseInt(group, 16)]

      const [a = 0, b = 0, c = 0, d = 0] = group.split(".").map(Number)

      return [a * 256 + b, c * 256 + d]
    })
}

/** The 4 or 16 bytes of an IPv4 or IPv6 address. */
function addressBytes(address: string): Buffer {
  if (isIP(address) === 4) return Buffer.from(address.split(".").map(Number))

  const [head = "", tail] = address.split("::")
  const start = words(head)
  const end = words(tail)
  const all = [...start, ...Array.from({ length: 8 - start.length - end.length }, () => 0), ...end]
  const bytes = Buffer.alloc(16)

  all.forEach((word, index) => bytes.writeUInt16BE(word, index * 2))

  return bytes
}

/**
 * The names a host's certificate covers. A DNS name with an underscore is not a valid certificate
 * name to every client, so its parent's wildcard (`*.example.com` for `a_b.example.com`) goes in
 * beside it; an address goes in as an address, which is how clients check one.
 */
function altNames(host: string): Buffer {
  if (isIP(host) !== 0) return sequence(implicit(7, addressBytes(host)))

  const names = [host]
  const [first = "", ...parent] = host.split(".")

  if (first.includes("_") && parent.length >= 2 && !parent.some((label) => label.includes("_")))
    names.push(`*.${parent.join(".")}`)

  return sequence(...names.map((dns) => implicit(2, Buffer.from(dns, "ascii"))))
}

/** A certificate authority that mints a certificate for each host. */
export interface Authority {
  /** PEM of the CA certificate. */
  readonly cert: string
  /** Base64 SHA-256 of the CA's SubjectPublicKeyInfo: what Chromium's SPKI allow-list takes. */
  readonly spki: string
  /** A TLS context that presents a certificate for `host` (cached per host), with the CA after it. */
  contextFor(host: string): Promise<SecureContext>
}

/** A host's certificate and key, in PEM, signed by the CA. */
async function leafFor(
  host: string,
  ca: { readonly subject: Buffer; readonly keyId: Buffer; readonly privateKey: KeyObject },
  now: Date,
) {
  const keys = await sharedLeafKeys()
  const notBefore = new Date(now.getTime() - BACKDATE_MS)
  const notAfter = new Date(now.getTime() + LEAF_LIFETIME_MS)
  const der = signCertificate(
    {
      issuer: ca.subject,
      subject: name(host.length <= MAX_COMMON_NAME ? [[OIDS.commonName, host]] : []),
      publicKey: keys.publicKey,
      notBefore,
      notAfter,
      extensions: [
        extension(OIDS.basicConstraints, true, sequence()),
        /* digitalSignature and keyEncipherment: bits 0 and 2 of 3, so 5 unused. */
        extension(OIDS.keyUsage, true, bitString(Buffer.from([0xa0]), 5)),
        extension(OIDS.extendedKeyUsage, false, sequence(oid(OIDS.serverAuth))),
        /* A certificate with no subject names its host in the SAN alone, which must then be critical. */
        extension(OIDS.subjectAltName, host.length > MAX_COMMON_NAME, altNames(host)),
        extension(OIDS.authorityKeyId, false, sequence(implicit(0, ca.keyId))),
      ],
    },
    ca.privateKey,
  )

  return {
    cert: pem(der, "CERTIFICATE"),
    key: keys.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    expiresAt: notAfter.getTime(),
  }
}

/** Hostnames are compared without case, and `example.com.` names the same host as `example.com`. */
export function normalHost(host: string): string {
  const bare = host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host
  const lower = bare.toLowerCase()

  return lower.endsWith(".") ? lower.slice(0, -1) : lower
}

/** Makes a CA named `commonName`, valid from a day ago for a year. */
export async function createAuthority(commonName: string): Promise<Authority> {
  const { publicKey, privateKey } = await rsaKeyPair()
  const subject = name([
    [OIDS.organization, "danwo"],
    [OIDS.commonName, commonName],
  ])
  const keyId = keyIdentifier(publicKey)
  const now = new Date()
  const der = signCertificate(
    {
      issuer: subject,
      subject,
      publicKey,
      notBefore: new Date(now.getTime() - BACKDATE_MS),
      notAfter: new Date(now.getTime() + CA_LIFETIME_MS),
      extensions: [
        extension(OIDS.basicConstraints, true, sequence(boolean(true))),
        /* digitalSignature, keyCertSign and cRLSign: bits 0, 5 and 6 of 7, so 1 unused. */
        extension(OIDS.keyUsage, true, bitString(Buffer.from([0x86]), 1)),
        extension(OIDS.subjectKeyId, false, octetString(keyId)),
        extension(OIDS.authorityKeyId, false, sequence(implicit(0, keyId))),
      ],
    },
    privateKey,
  )
  const cert = pem(der, "CERTIFICATE")
  const spki = createHash("sha256")
    .update(new X509Certificate(cert).publicKey.export({ type: "spki", format: "der" }))
    .digest("base64")
  const contexts = new Map<string, Promise<{ context: SecureContext; expiresAt: number }>>()
  const ca = { subject, keyId, privateKey }

  /** The cached context for `host`, minted again once it is within a day of expiring. */
  const contextFor = async (host: string): Promise<SecureContext> => {
    const key = normalHost(host) || "localhost"
    const cached = contexts.get(key)

    if (cached !== undefined) {
      const entry = await cached

      if (entry.expiresAt - Date.now() > DAY_MS) return entry.context
    }

    const minted = leafFor(key, ca, new Date()).then((leaf) => ({
      context: createSecureContext({ key: leaf.key, cert: `${leaf.cert}${cert}` }),
      expiresAt: leaf.expiresAt,
    }))

    contexts.set(key, minted)
    minted.catch(() => contexts.delete(key))

    return (await minted).context
  }

  return { cert, spki, contextFor }
}
