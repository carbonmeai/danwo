/**
 * The worker's calls out: a digest email or an owner's notice through Resend, and a batch of
 * emails billed through Stripe. Each call carries an idempotency key made from what it is for, so
 * a step that Inngest runs again after the provider acted, but before its answer arrived, gets the
 * first answer back instead of a second email or a second charge. A failure says whether another
 * try could help: Inngest retries the step unless it is a `NonRetriableError`.
 */
import { NonRetriableError, RetryAfterError } from "inngest"
import { Resend } from "resend"
import { Stripe } from "stripe"
import { z } from "zod"

import { broken } from "../lib/bugs.ts"
import { EMAIL_PRICE, TEAM_CUSTOMER } from "../lib/inngest.ts"

const Env = z.object({
  RESEND_API_KEY: z.string().startsWith("re_"),
  STRIPE_SECRET_KEY: z.string().startsWith("sk_"),
  MAIL_FROM: z.string().default("Northwind Digest <digest@northwind.test>"),
})

const settings = Env.parse(process.env)
const resend = new Resend(settings.RESEND_API_KEY)
/*
 * The SDK keys each POST itself and retries a dropped connection under that key; a failure it
 * cannot get past fails the step, which Inngest retries, under the batch's own key.
 */
const stripe = new Stripe(settings.STRIPE_SECRET_KEY, { maxNetworkRetries: 2, timeout: 5_000 })

/** How long a send may take before the step gives up and Inngest tries it again. */
const SEND_TIMEOUT_MS = 5_000

/** Resend's errors that no retry gets past: the address or the email itself is wrong. */
const PERMANENT = new Set([
  "validation_error",
  "missing_required_field",
  "invalid_idempotent_request",
  "invalid_from_address",
])

/** Rejects when `promise` takes longer than `ms`, so a hung call fails the step. */
function within<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} took longer than ${ms} ms`)), ms)
  })

  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

/** An email to send through Resend, and the key that makes it go once. */
export interface Email {
  readonly to: string
  readonly subject: string
  readonly text: string
  readonly html: string
  readonly key: string
}

/** Sends `email` through Resend and answers its id; throws what Inngest should do about a failure. */
export async function sendEmail(email: Email): Promise<string> {
  const { key, ...message } = email
  const { data, error } = await within(
    resend.emails.send(
      { from: settings.MAIL_FROM, ...message },
      broken("no-idempotency") ? undefined : { idempotencyKey: key },
    ),
    SEND_TIMEOUT_MS,
    "resend emails.send",
  )

  if (error === null && data !== null) return data.id

  const why = `Resend ${error?.name ?? "error"}: ${error?.message ?? "no answer"}`

  /*
   * Resend asks for a second's pause. Inngest schedules a retry to the whole second, so ask for two
   * to be sure a full one has passed.
   */
  if (error?.name === "rate_limit_exceeded") throw new RetryAfterError(why, "2s")
  if (error && PERMANENT.has(error.name)) throw new NonRetriableError(why)

  throw new Error(why)
}

/** What billing one batch came to: Stripe's invoice item and its amount. */
export interface Billed {
  readonly stripeItemId: string
  readonly amountCents: number
}

/**
 * Bills `quantity` digest emails to the team's Stripe customer as one invoice item, which its
 * next invoice picks up. The key is the digest and the batch, so a retried step bills it once.
 */
export async function billBatch(batch: {
  readonly digestId: string
  readonly batch: number
  readonly quantity: number
  readonly title: string
}): Promise<Billed> {
  const item = await stripe.invoiceItems.create(
    {
      customer: TEAM_CUSTOMER,
      pricing: { price: EMAIL_PRICE },
      quantity: batch.quantity,
      description: `${batch.quantity} digest emails: ${batch.title}`,
      metadata: { digest_id: batch.digestId, batch: String(batch.batch) },
    },
    broken("no-idempotency")
      ? undefined
      : { idempotencyKey: `usage-${batch.digestId}-${batch.batch}` },
  )

  return { stripeItemId: item.id, amountCents: item.amount }
}
