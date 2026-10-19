import { randomInt } from "node:crypto"

import { type ClerkContext, instanceOf, now } from "./context.ts"
import { newUser } from "./entities.ts"
import { clerkId } from "./helpers.ts"
import type { AttemptRecord } from "./store.ts"

/** How many wrong codes an attempt takes before it must start over. */
export const MAX_CODE_TRIES = 3

/** How long an emailed code stays good: ten minutes. */
export const CODE_LIFETIME_MS = 10 * 60 * 1000

/** Sends a six-digit code to `to` and returns it. */
function emailCode(context: ClerkContext, to: string): string {
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0")

  context.clerk.messages.add(
    {
      id: clerkId("msg"),
      to,
      subject: `${code} is your verification code`,
      body: `Enter ${code} to continue to ${instanceOf(context).slug}. This code expires in 10 minutes.`,
      code,
      sent_at: now(context),
    },
    null,
  )

  return code
}

/** The fields a new attempt starts with. */
export interface NewAttempt {
  readonly clientId: string
  readonly identifier: string
  readonly userId: string | null
  readonly password: string | null
  readonly firstName?: string | null
  readonly lastName?: string | null
}

/** A new sign-in or sign-up, waiting for its first factor or verification. */
export function newAttempt(
  context: ClerkContext,
  kind: AttemptRecord["kind"],
  fields: NewAttempt,
): AttemptRecord {
  return context.clerk.attempts.add(
    {
      id: clerkId(kind === "sign_in" ? "sia" : "sua"),
      kind,
      client_id: fields.clientId,
      identifier: fields.identifier,
      user_id: fields.userId,
      status: kind === "sign_in" ? "needs_first_factor" : "missing_requirements",
      strategy: null,
      code: null,
      code_sent_at: null,
      attempts: 0,
      password: fields.password,
      first_name: fields.firstName ?? null,
      last_name: fields.lastName ?? null,
      created_session_id: null,
      created_at: now(context),
    },
    null,
  )
}

/** Emails a fresh code for an attempt and records that it is waiting on it. */
export function sendAttemptCode(context: ClerkContext, attempt: AttemptRecord): AttemptRecord {
  return (
    context.clerk.attempts.change(attempt.id, {
      strategy: "email_code",
      code: emailCode(context, attempt.identifier),
      code_sent_at: now(context),
      attempts: 0,
    }) ?? attempt
  )
}

/** Why a code does not complete an attempt, or null when it does. */
export type CodeProblem = "too_many" | "expired" | "incorrect" | null

/** Checks a code against an attempt, counting a wrong one. */
export function checkCode(
  context: ClerkContext,
  attempt: AttemptRecord,
  code: string,
): CodeProblem {
  if (attempt.attempts >= MAX_CODE_TRIES) return "too_many"
  if (now(context) - (attempt.code_sent_at ?? 0) > CODE_LIFETIME_MS) return "expired"
  if (attempt.code !== null && attempt.code === code.trim()) return null

  context.clerk.attempts.change(attempt.id, { attempts: attempt.attempts + 1 })

  return "incorrect"
}

/** Creates the user a completed sign-up asked for, its email verified by the code. */
export function createSignedUpUser(context: ClerkContext, attempt: AttemptRecord): string {
  const user = newUser(
    {
      emails: [attempt.identifier],
      firstName: attempt.first_name,
      lastName: attempt.last_name,
      hasPassword: attempt.password !== null,
    },
    now(context),
  )

  const created = context.clerk.users.add(user, { password: attempt.password })

  context.events.user("user.created", created)

  return created.id
}
