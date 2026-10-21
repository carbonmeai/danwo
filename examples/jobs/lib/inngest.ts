/**
 * The Inngest client both apps share, and the events between them. The API sends
 * `digest/scheduled`; the worker's scheduler fans each due digest out as one `digest/send-one`
 * per subscriber and one `digest/charge` per batch. Every event carries an `id`, so a send that
 * is retried after its answer was lost is the same event, and Inngest runs it once.
 */
import { eventType, Inngest } from "inngest"
import { z } from "zod"

export const inngest = new Inngest({ id: "digests" })

/** A digest was scheduled: the scheduler looks at once, so one due now need not wait an hour. */
export const DigestScheduled = eventType("digest/scheduled", {
  schema: z.object({ digestId: z.string() }),
})

/** One subscriber's copy of a digest is due. */
export const SendOne = eventType("digest/send-one", {
  schema: z.object({ digestId: z.string(), subscriberId: z.string() }),
})

/** One batch of a digest's emails is due to be billed. */
export const Charge = eventType("digest/charge", {
  schema: z.object({ digestId: z.string(), batch: z.number().int(), quantity: z.number().int() }),
})

/** How many emails one fan-out event send and one invoice item cover. */
export const BATCH_SIZE = 50

/** What one digest email costs, in cents: the price billed per email. */
export const CENTS_PER_EMAIL = 2

/** The Stripe price for one digest email, and the team account it is billed to. */
export const EMAIL_PRICE = "price_digest_email"
export const TEAM_CUSTOMER = "cus_northwind_team"
