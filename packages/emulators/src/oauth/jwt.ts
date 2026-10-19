import {
  createHash,
  createPrivateKey,
  createPublicKey,
  createSign,
  generateKeyPairSync,
  type KeyObject,
} from "node:crypto"

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
  /** Signs `claims`; `header` adds fields to the JWT header (Clerk adds `cat` and `oiat`). */
  sign(claims: Record<string, unknown>, header?: Record<string, unknown>): string
}

const base64url = (value: string | Buffer) => Buffer.from(value).toString("base64url")

/** The key pair of a private key PEM. */
function keyPairOf(privatePem: string): { privateKey: KeyObject; publicKey: KeyObject } {
  const privateKey = createPrivateKey(privatePem)

  return { privateKey, publicKey: createPublicKey(privateKey) }
}

function publicJwk(key: KeyObject, kid: string): PublicJwk {
  const { n = "", e = "", kty = "RSA" } = key.export({ format: "jwk" })

  return { kty, n, e, kid, use: "sig", alg: "RS256" }
}

/**
 * A fresh 2048-bit RSA key, or the one in `privatePem` (PKCS#8 or PKCS#1 PEM), so tokens verify
 * across runs. Its id is derived from the public key, so it is stable per key.
 */
export function createSigningKey(privatePem?: string): SigningKey {
  const { privateKey, publicKey } =
    privatePem === undefined
      ? generateKeyPairSync("rsa", { modulusLength: 2048 })
      : keyPairOf(privatePem)
  const pem = publicKey.export({ format: "pem", type: "spki" }).toString()
  const kid = createHash("sha256").update(pem).digest("hex").slice(0, 40)

  return {
    kid,
    jwk: publicJwk(publicKey, kid),
    pem,
    sign(claims, extra = {}) {
      const header = base64url(JSON.stringify({ alg: "RS256", kid, typ: "JWT", ...extra }))
      const payload = base64url(JSON.stringify(claims))
      const signature = createSign("RSA-SHA256").update(`${header}.${payload}`).sign(privateKey)

      return `${header}.${payload}.${base64url(signature)}`
    },
  }
}
