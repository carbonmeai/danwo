import { type ErrorResponse, Resend } from "resend"

import { withRetry } from "./retry.ts"

/** Who support email comes from. */
export const SENDER = "Paper & Clay support <support@paperandclay.example>"

/** The subject of the email a ticket sends: the tests find it by the ticket's number. */
export function ticketSubject(ticket: string): string {
  return `We've opened ticket ${ticket} for you`
}

/** A refused send, and whether (and after how long) trying again can work. */
class ResendFailure extends Error {
  readonly retryable: boolean | number

  constructor(error: ErrorResponse, headers: Readonly<Record<string, string>> | null) {
    super(`Resend refused the ticket email: ${error.name}: ${error.message}`)

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

/** The Resend client, made on first use so this module loads without a key. */
function resend(): Resend {
  client ??= new Resend(process.env.RESEND_API_KEY)

  return client
}

/** What a ticket email says. */
export interface TicketEmail {
  readonly ticket: string
  readonly to: string
  readonly customer: string
  readonly orderNumber: string
  readonly summary: string
}

/**
 * Emails the customer a copy of their ticket. The idempotency key is the ticket's, so a retry, or
 * a second request for the same ticket, returns the first send instead of sending again.
 */
export async function sendTicketEmail(email: TicketEmail): Promise<void> {
  const firstName = email.customer.split(" ")[0] ?? email.customer

  await withRetry(
    async () => {
      const { error, headers } = await resend().emails.send(
        {
          from: SENDER,
          to: email.to,
          subject: ticketSubject(email.ticket),
          text: [
            `Hi ${firstName},`,
            `We've opened ticket ${email.ticket} about order ${email.orderNumber}: ${email.summary}`,
            "Someone from the studio will write within a working day.",
          ].join("\n\n"),
        },
        { idempotencyKey: `ticket/${email.ticket}` },
      )

      if (error) throw new ResendFailure(error, headers)
    },
    (error) => !(error instanceof ResendFailure) || error.retryable,
  )
}
