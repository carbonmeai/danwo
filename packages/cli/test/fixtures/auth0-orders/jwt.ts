/** RS256 checks the orders app and its test share: a JWT's claims, and whether a key set signed it. */
import { createPublicKey, type JsonWebKey, verify } from "node:crypto"

/** A JWT's payload, unverified. */
export function claimsOf(token: string): Record<string, unknown> {
  const [, payload = ""] = token.split(".")

  try {
    const parsed: unknown = JSON.parse(Buffer.from(payload, "base64url").toString())

    return isObject(parsed) ? Object.fromEntries(Object.entries(parsed)) : {}
  } catch {
    return {}
  }
}

/** The keys of a JWKS document. */
export function keysOf(jwks: unknown): JsonWebKey[] {
  const keys: unknown = isObject(jwks) && "keys" in jwks ? jwks.keys : []

  return Array.isArray(keys) ? keys.filter(isObject) : []
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

/** Whether one of `keys` made the token's RS256 signature. */
export function signedBy(keys: readonly JsonWebKey[], token: string): boolean {
  const [header = "", payload = "", signature = ""] = token.split(".")
  const signed = Buffer.from(`${header}.${payload}`)

  return keys.some((key) => {
    try {
      return verify(
        "RSA-SHA256",
        signed,
        createPublicKey({ key, format: "jwk" }),
        Buffer.from(signature, "base64url"),
      )
    } catch {
      return false
    }
  })
}
