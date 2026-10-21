/**
 * The email Harbor sends: a six-digit sign-in code, and the link that confirms a new password
 * account's address. Both go through Resend, retried when Resend fails for a moment, with an
 * idempotency key so a retry after a lost answer never sends a second copy.
 */
import { AsyncLocalStorage } from "node:async_hooks"
import { randomUUID } from "node:crypto"

import { type ErrorResponse, Resend } from "resend"

import { describe, retrying } from "./retry.ts"
import { broken, settings } from "./settings.ts"

/** The sign-in code's subject, which the tests look for. */
export const CODE_SUBJECT = "Your Harbor sign-in code"

/** The confirmation link's subject. */
export const CONFIRM_SUBJECT = "Confirm your email for Harbor"

/** A refused send, and whether (and after how long) trying again can work. */
class ResendFailure extends Error {
  readonly retryable: boolean | number

  constructor(error: ErrorResponse, headers: Readonly<Record<string, string>> | null) {
    super(`Resend refused the email: ${error.name}: ${error.message}`)

    const retryAfter = Number(headers?.["retry-after"])

    /*
     * No status means the request never got an answer, and a 5xx is Resend's own trouble. A 429
     * says how long to wait in `Retry-After`. A concurrent request with the same key is still
     * running, and a retry gets its answer.
     */
    if (error.statusCode === 429)
      this.retryable = Number.isFinite(retryAfter) ? retryAfter * 1_000 : true
    else
      this.retryable =
        error.statusCode === null ||
        error.statusCode >= 500 ||
        error.name === "concurrent_idempotent_requests"
  }
}

const resend = new Resend(settings.RESEND_API_KEY)

/** Whether an email failed to go out while a request was being answered. */
interface Delivery {
  failed: boolean
}

/** The request being answered, for marking a send that failed. */
const watching = new AsyncLocalStorage<Delivery>()

/** One email to one person. */
interface Message {
  readonly to: string
  readonly subject: string
  readonly text: string
  readonly html: string
  /** What it is for, the start of its idempotency key: `sign-in-code`, `confirm-email`. */
  readonly purpose: string
}

/**
 * Sends `message`, retrying a 429, a 5xx or a lost answer. The idempotency key is made once per
 * send, so every retry carries the same one and Resend sends at most one copy; a second request
 * from the person is a new send with a key of its own.
 */
async function send(message: Message): Promise<void> {
  const key = `${message.purpose}/${randomUUID()}`

  await retrying(
    {
      name: "resend emails.send",
      attempts: 6,
      retryable: (error) => !(error instanceof ResendFailure) || error.retryable,
    },
    async () => {
      const { error, headers } = await resend.emails.send(
        {
          from: settings.MAIL_FROM,
          to: message.to,
          subject: message.subject,
          text: message.text,
          html: message.html,
        },
        broken("no-idempotency-key") ? {} : { idempotencyKey: key },
      )

      if (error) throw new ResendFailure(error, headers)
    },
  ).catch((error: unknown) => {
    console.error(`could not email ${message.to}: ${describe(error)}`)

    const watched = watching.getStore()

    if (watched) watched.failed = true
    throw error
  })
}

/**
 * Runs `work` (answering one request) and says whether any email it sent failed for good. Better
 * Auth logs a failed send and answers as if it went, so without this the person would wait for a
 * code that never comes.
 */
export async function watchDelivery(work: () => Promise<void>): Promise<Delivery> {
  const delivery: Delivery = { failed: false }

  await watching.run(delivery, work)

  return delivery
}

/** Emails `email` the code that signs them in, which lasts `minutes`. */
export function sendSignInCode(email: string, code: string, minutes: number): Promise<void> {
  return send({
    to: email,
    purpose: "sign-in-code",
    subject: CODE_SUBJECT,
    text: `Your Harbor sign-in code is ${code}. It expires in ${minutes} minutes. If you didn't ask for it, you can ignore this email.`,
    html: `<p>Your Harbor sign-in code is</p><p style="font-size:24px;font-weight:600;letter-spacing:4px">${code}</p><p>It expires in ${minutes} minutes. If you didn't ask for it, you can ignore this email.</p>`,
  })
}

/** Emails `email` the link that confirms their address and signs them in. */
export function sendConfirmation(email: string, name: string, url: string): Promise<void> {
  return send({
    to: email,
    purpose: "confirm-email",
    subject: CONFIRM_SUBJECT,
    text: `Hi ${name}, confirm your email for Harbor: ${url}`,
    html: `<p>Hi ${escape(name)},</p><p><a href="${escape(url)}">Confirm your email</a> to finish signing up for Harbor.</p>`,
  })
}

/** `text` safe to put in HTML. */
function escape(text: string): string {
  return text.replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] ?? char,
  )
}
