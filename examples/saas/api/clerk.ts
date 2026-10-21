/**
 * Relay's Clerk client. Clerk's SDK doesn't retry, so `clerkCall` does: on a 429 (waiting as long
 * as Clerk asks), a 5xx, a dropped connection or a call that hangs. A retried write must be safe to
 * repeat, which is the caller's job: see how onboarding names each organization.
 */
import { createClerkClient, verifyToken } from "@clerk/backend"
import { isClerkAPIResponseError } from "@clerk/backend/errors"

import { broken } from "../shared/bugs.ts"
import { retrying, TimeoutError, withTimeout } from "../shared/retry.ts"
import { settings } from "./settings.ts"

export const clerk = createClerkClient({ secretKey: settings.CLERK_SECRET_KEY })

/** Whether a failed Clerk call is worth another try. */
function retryable(error: unknown): boolean {
  /* No answer at all: the connection dropped, or the call hung. */
  if (error instanceof TimeoutError || !isClerkAPIResponseError(error)) return true

  /* Clerk's SDK reports a dropped connection as an API error with no status of its own. */
  const status = Number(error.status)

  return !(status >= 400 && status < 500) || status === 429
}

/** How long to wait before the next try: what a 429 asked for, else a short, growing pause. */
function delayMs(attempt: number, error: unknown): number {
  if (isClerkAPIResponseError(error) && error.retryAfter !== undefined)
    return Math.min(error.retryAfter * 1000, 5_000)

  return 250 * attempt
}

/**
 * Runs one Clerk call with Relay's retry policy. With SAAS_BUG=no-onboarding-retry it runs once:
 * the first 429 or 5xx is the caller's to deal with.
 */
export function clerkCall<T>(name: string, call: () => Promise<T>): Promise<T> {
  const once = () => withTimeout(call(), 5_000, `clerk ${name}`)

  if (broken("no-onboarding-retry")) return once()

  return retrying({ name: `clerk ${name}`, attempts: 5, retryable, delayMs }, once)
}

/** The Clerk error code of a failed call, such as `form_identifier_exists`. */
export function clerkCode(error: unknown): string | undefined {
  return isClerkAPIResponseError(error) ? error.errors[0]?.code : undefined
}

/** The signed-in user a request's session token names, or undefined when it doesn't check out. */
export async function userIdOf(authorization: string | undefined): Promise<string | undefined> {
  const token = /^Bearer\s+(\S+)$/.exec(authorization ?? "")?.[1]

  if (!token) return undefined

  try {
    const claims = await verifyToken(token, { jwtKey: settings.CLERK_JWT_KEY })

    return claims.sub
  } catch {
    return undefined
  }
}
