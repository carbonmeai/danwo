import { createHash, createSign, generateKeyPairSync, type KeyObject } from "node:crypto"

/** The public half of a signing key, as a JWKS lists it. */
export interface PublicJwk {
  readonly kty: string
  readonly n: string
  readonly e: string
  readonly kid: string
  readonly use: "sig"
  readonly alg: "RS256"
}

/** An RS256 key an emulator signs its ID tokens with. */
export interface SigningKey {
  readonly kid: string
  readonly jwk: PublicJwk
  /** The public key as PEM, for endpoints that serve certificates by key id. */
  readonly pem: string
  sign(claims: Record<string, unknown>): string
}

const base64url = (value: string | Buffer) => Buffer.from(value).toString("base64url")

function publicJwk(key: KeyObject, kid: string): PublicJwk {
  const { n, e, kty } = key.export({ format: "jwk" }) as { n: string; e: string; kty: string }

  return { kty, n, e, kid, use: "sig", alg: "RS256" }
}

/** A fresh 2048-bit RSA key; its id is derived from the public key, so it is stable per key. */
export function createSigningKey(): SigningKey {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 })
  const pem = publicKey.export({ format: "pem", type: "spki" }).toString()
  const kid = createHash("sha256").update(pem).digest("hex").slice(0, 40)

  return {
    kid,
    jwk: publicJwk(publicKey, kid),
    pem,
    sign(claims) {
      const header = base64url(JSON.stringify({ alg: "RS256", kid, typ: "JWT" }))
      const payload = base64url(JSON.stringify(claims))
      const signature = createSign("RSA-SHA256").update(`${header}.${payload}`).sign(privateKey)

      return `${header}.${payload}.${base64url(signature)}`
    },
  }
}
