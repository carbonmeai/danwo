import { createHash } from "node:crypto"

import { createSigningKey, type SigningKey } from "../oauth/jwt.ts"
import type { PushSubscriptionRecord } from "./entities.ts"
import { GOOGLE_ISSUER } from "./helpers.ts"

/**
 * The OIDC token Google puts in `Authorization` on a push from an authenticated Pub/Sub
 * subscription. It is signed with the same key the emulator serves at Google's certificate URLs, so
 * an app verifying it the usual way accepts it.
 */

/** A push token is valid for an hour after it is issued. */
const TOKEN_LIFETIME_S = 60 * 60

/**
 * An attempt timed this far before the emulator's clock is a stale one: its token was issued so
 * long ago that it has already expired.
 */
const STALE_AFTER_S = 60

/** What the endpoint secret is for a subscription whose pushes carry a token. */
export const SIGNED_PUSH = "oidc"

/** A key no certificate lists: tokens signed with it fail verification, as forgeries do. */
let forger: SigningKey | undefined

/** One push attempt's signing inputs. */
export interface PushSigning {
  /** The key the emulator serves at its certificate URLs. */
  readonly key: SigningKey
  /** Unix seconds the dispatcher stamped on this attempt. */
  readonly timestamp: number
  /** Unix seconds now, by the emulator's clock. */
  readonly now: number
}

/** A stable 21-digit id for a service account, the shape of Google's `sub`. */
function accountId(email: string): string {
  const digits = BigInt(`0x${createHash("sha256").update(email).digest("hex").slice(0, 16)}`)

  return `1${digits.toString().padStart(20, "0").slice(-20)}`
}

/** When the token was issued and when it expires; a stale attempt's token has already expired. */
function lifetime(signing: PushSigning): { iat: number; exp: number } {
  const stale = signing.now - signing.timestamp > STALE_AFTER_S
  const iat = stale ? signing.timestamp - TOKEN_LIFETIME_S : signing.timestamp

  return { iat, exp: iat + TOKEN_LIFETIME_S }
}

/** The token's signature replaced by one from a key Google never published. */
function forge(token: string, claims: Record<string, unknown>): string {
  forger ??= createSigningKey()

  const [header, payload] = token.split(".")
  const signature = forger.sign(claims).split(".")[2]

  return `${header}.${payload}.${signature}`
}

/**
 * The `Authorization` header for a push to `subscription`. `forged` signs it with a key the
 * certificates don't list, as a push from anyone but Google would be.
 */
export function pushAuthorization(
  subscription: PushSubscriptionRecord,
  signing: PushSigning,
  forged: boolean,
): Record<string, string> {
  if (!subscription.oidc) return {}

  const id = accountId(subscription.oidc.serviceAccountEmail)
  const claims = {
    iss: GOOGLE_ISSUER,
    aud: subscription.oidc.audience ?? subscription.endpoint,
    azp: id,
    sub: id,
    email: subscription.oidc.serviceAccountEmail,
    email_verified: true,
    ...lifetime(signing),
  }
  const token = signing.key.sign(claims)

  return { authorization: `Bearer ${forged ? forge(token, claims) : token}` }
}
