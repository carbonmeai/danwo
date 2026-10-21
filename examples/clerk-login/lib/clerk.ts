/**
 * Calls to Clerk's Backend API, with retries for what can be repeated. Clerk answers a burst with
 * 429 and how long to wait in `Retry-After`; a 5xx or a dropped connection is Clerk's own trouble
 * and worth another try. Anything else (a 4xx) is an answer, and is thrown as it is.
 */
import { isClerkAPIResponseError } from "@clerk/nextjs/errors"
import { clerkClient } from "@clerk/nextjs/server"

import { withRetry } from "./retry.ts"

/** The Backend API client `@clerk/nextjs` builds from `CLERK_SECRET_KEY`. */
export type ClerkClient = Awaited<ReturnType<typeof clerkClient>>

/** Whether a failed Backend API call is worth repeating, and after how long. */
export function retryable(error: unknown): boolean | number {
  if (!isClerkAPIResponseError(error)) return true
  if (error.status === 429) return error.retryAfter === undefined ? true : error.retryAfter * 1_000

  return error.status >= 500
}

/**
 * Runs `call` against the Backend API, retrying 429s, 5xx and lost connections: for server
 * actions and route handlers. Only pass calls that are safe to repeat: a read, or a write Clerk
 * itself refuses to make twice.
 */
export async function backend<T>(call: (clerk: ClerkClient) => Promise<T>): Promise<T> {
  const clerk = await clerkClient()

  return withRetry(() => call(clerk), retryable)
}

/** How a caller reaches the Backend API: `backend` with retries, or `once`. */
export type Reach = <T>(call: (clerk: ClerkClient) => Promise<T>) => Promise<T>

/**
 * Runs `call` once, for a page as it renders: retrying inside the render would not help, because
 * Next.js answers a repeated GET in one render from its first answer, failure included. A page
 * that meets a failure says so and asks again a moment later, in a new render.
 */
export async function once<T>(call: (clerk: ClerkClient) => Promise<T>): Promise<T> {
  return call(await clerkClient())
}

/**
 * `work`, or a rejection once `ms` pass without it settling: a page that would rather show what it
 * has than wait on a slow Clerk.
 */
export function within<T>(ms: number, work: Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no answer within ${ms} ms`)), ms)

    work.then(resolve, reject).finally(() => clearTimeout(timer))
  })
}

/** The Clerk error code of a refused call, such as `form_identifier_exists`. */
export function clerkErrorCode(error: unknown): string | undefined {
  return isClerkAPIResponseError(error) ? error.errors[0]?.code : undefined
}
