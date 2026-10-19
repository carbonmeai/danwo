/** Checking the HS256 JWTs app servers sign with a shared secret, as Beams and Tiptap tokens are. */
import { createHmac } from "node:crypto"

import { asRecord } from "./json.ts"

/**
 * The claims of an HS256 JWT signed with `secret`; undefined when it is not one, its signature
 * does not match, or its `exp` has passed.
 */
export function hs256Claims(token: string, secret: string): Record<string, unknown> | undefined {
  const [header, payload, signature] = token.split(".")

  if (header === undefined || payload === undefined || signature === undefined) return undefined

  const expected = createHmac("sha256", secret).update(`${header}.${payload}`).digest("base64url")

  if (expected !== signature) return undefined

  try {
    const claims = asRecord(JSON.parse(Buffer.from(payload, "base64url").toString("utf8")))
    const exp = claims?.["exp"]

    if (typeof exp === "number" && exp * 1000 < Date.now()) return undefined

    return claims
  } catch {
    return undefined
  }
}
