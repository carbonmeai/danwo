/**
 * What Harbor puts in front of Better Auth's code endpoints, so a form sent twice, or an email
 * that didn't go, never leaves a person with a dead code or a wrong answer.
 */
import type { MiddlewareHandler } from "hono"
import { z } from "zod"

import { pool } from "./auth.ts"
import { watchDelivery } from "./mail.ts"

/** What the page says when an email didn't go out. */
const NOT_SENT = {
  code: "EMAIL_NOT_SENT",
  message: "We couldn't send the email just now. Please try again.",
} as const

/** The tail of each address's queue of code requests and sign-ins. */
const queues = new Map<string, Promise<unknown>>()

/** Runs `work` once every earlier piece of work for `key` has finished. */
async function inTurn(key: string, work: () => Promise<void>): Promise<void> {
  const mine = (queues.get(key) ?? Promise.resolve()).then(work)
  const settled = mine.catch(() => undefined)

  queues.set(key, settled)
  try {
    await mine
  } finally {
    if (queues.get(key) === settled) queues.delete(key)
  }
}

/** The JSON body of the request, parsed with `schema`, leaving the body for Better Auth. */
async function bodyOf<T>(request: Request, schema: z.ZodType<T>): Promise<T | undefined> {
  const parsed = schema.safeParse(
    await request
      .clone()
      .json()
      .catch(() => null),
  )

  return parsed.success ? parsed.data : undefined
}

/**
 * Answers 503 when the email a request should have sent didn't go, even after retries, so the
 * page can say so and the person can ask again.
 */
export const emailWentOut: MiddlewareHandler = async (c, next) => {
  const delivery = await watchDelivery(next)

  if (delivery.failed) c.res = c.json(NOT_SENT, 503)
}

const CodeRequest = z.object({ email: z.string(), type: z.string() })

/**
 * A request for a code, one address at a time. Better Auth makes a new code for each request and
 * emails it; two at once (a double click, a form sent twice) could store one code and email the
 * other last, so the newest email would hold a code that no longer works. A code whose email
 * failed is thrown away with a 503, so no code works that nobody received.
 */
export const oneCodeAtATime: MiddlewareHandler = async (c, next) => {
  const request = await bodyOf(c.req.raw, CodeRequest)

  if (request === undefined) return next()

  const email = request.email.toLowerCase()

  await inTurn(`code ${email}`, async () => {
    const delivery = await watchDelivery(next)

    if (!delivery.failed) return

    await pool.query("delete from verification where identifier = $1", [
      `${request.type}-otp-${email}`,
    ])
    c.res = c.json(NOT_SENT, 503)
  })
}

const SignIn = z.object({ email: z.string(), otp: z.string() })

/** How long a sign-in's answer is kept for the same form sent again. */
const ANSWER_MS = 10_000

/** A sign-in's answer: status, headers (the session cookie among them) and body. */
interface Answer {
  readonly status: number
  readonly headers: readonly [string, string][]
  readonly body: string
}

/** The last few seconds' successful sign-ins, by address and code. */
const answers = new Map<string, Answer>()

/**
 * Signing in with a code, one address at a time, and the same form sent twice gets the same
 * answer. A code works once, so without this the second copy of a double-submitted form is told
 * the code is wrong, and the browser may show that answer although the first signed it in.
 */
export const oneSignInPerCode: MiddlewareHandler = async (c, next) => {
  const request = await bodyOf(c.req.raw, SignIn)

  if (request === undefined) return next()

  const email = request.email.toLowerCase()
  const key = `${email} ${request.otp.trim()}`

  await inTurn(`sign-in ${email}`, async () => {
    const earlier = answers.get(key)

    if (earlier) {
      c.res = new Response(earlier.body, { status: earlier.status, headers: [...earlier.headers] })

      return
    }

    await next()
    if (c.res.status !== 200) return

    const copy = c.res.clone()

    answers.set(key, {
      status: copy.status,
      headers: [...copy.headers],
      body: await copy.text(),
    })
    setTimeout(() => answers.delete(key), ANSWER_MS).unref()
  })
}
