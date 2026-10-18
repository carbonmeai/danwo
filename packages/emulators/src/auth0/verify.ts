import { createVerify } from "node:crypto"

import { asRecord } from "../json.ts"
import type { SigningKey } from "../oauth/jwt.ts"
import type { Clock } from "../store.ts"

/**
 * The claims of a token this emulator signed, if its signature checks out and it hasn't expired.
 * Tokens from anywhere else, or past `exp`, give `undefined`.
 */
export function verifiedClaims(
  key: SigningKey,
  token: string,
  clock: Clock,
): Record<string, unknown> | undefined {
  const [header = "", payload = "", signature = ""] = token.split(".")

  if (signature === "") return undefined

  const valid = createVerify("RSA-SHA256")
    .update(`${header}.${payload}`)
    .verify(key.pem, Buffer.from(signature, "base64url"))

  if (!valid) return undefined

  const claims = asRecord(JSON.parse(Buffer.from(payload, "base64url").toString("utf8")))
  const exp = typeof claims?.exp === "number" ? claims.exp : 0

  return claims && exp * 1000 > clock().getTime() ? claims : undefined
}

/** Whether a token's `aud` (a string or a list) includes `audience`. */
export function hasAudience(claims: Record<string, unknown>, audience: string): boolean {
  const aud = claims.aud

  return Array.isArray(aud) ? aud.includes(audience) : aud === audience
}
