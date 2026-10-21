import { type ErrorResponse, Resend } from "resend"

import { withRetry } from "./retry.ts"

/** Who the welcome email comes from. */
export const SENDER = "Lumen <hello@lumen.example>"

/** The welcome email's subject, which the tests look for. */
export const WELCOME_SUBJECT = "You're on the Lumen waitlist"

/** A refused send, and whether (and after how long) trying again can work. */
class ResendFailure extends Error {
  readonly retryable: boolean | number

  constructor(error: ErrorResponse, headers: Readonly<Record<string, string>> | null) {
    super(`Resend refused the welcome email: ${error.name}: ${error.message}`)

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

let client: Resend | undefined

/** The Resend client, made on first use so this module loads without a key (as in the tests). */
function resend(): Resend {
  client ??= new Resend(process.env.RESEND_API_KEY)

  return client
}

/**
 * Sends the welcome email for signup `id`. The idempotency key makes a retry, or a second
 * request for the same signup, return the first send instead of sending again.
 */
export async function sendWelcome(id: string, email: string): Promise<void> {
  await withRetry(
    async () => {
      const { error, headers } = await resend().emails.send(
        {
          from: SENDER,
          to: email,
          subject: WELCOME_SUBJECT,
          text: "Thanks for joining the Lumen waitlist. We'll write again when your seat is ready.",
          html: "<p>Thanks for joining the Lumen waitlist.</p><p>We'll write again when your seat is ready.</p>",
        },
        { idempotencyKey: `welcome/${id}` },
      )

      if (error) throw new ResendFailure(error, headers)
    },
    (error) => !(error instanceof ResendFailure) || error.retryable,
  )
}
