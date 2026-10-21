/**
 * The background jobs:
 * - `scheduler`, every hour and whenever a digest is scheduled: claims the digests that are due
 *   and fans each one out, a batch of `digest/send-one` events per 50 subscribers and a
 *   `digest/charge` per batch;
 * - `send-one`: sends one subscriber's email through Resend and records the delivery, retried by
 *   Inngest when a step throws; once it fails for good, its `onFailure` handler marks the delivery
 *   failed and tells the digest's owner;
 * - `charge`: bills a batch of emails to the team through Stripe and records the charge.
 *
 * Every step is safe to run twice: Inngest remembers a step that finished, and runs one that threw
 * again, even when its call had landed.
 */
import { cron, invoke, NonRetriableError } from "inngest"
import { z } from "zod"

import { describe } from "../db/client.ts"
import { broken } from "../lib/bugs.ts"
import { Charge, DigestScheduled, inngest, SendOne } from "../lib/inngest.ts"
import { billBatch, sendEmail } from "./providers.ts"
import {
  batches,
  claimDue,
  deliveryOf,
  note,
  recordCharge,
  recordFailed,
  recordOwnerTold,
  recordSent,
  titleOf,
} from "./records.ts"

export const scheduler = inngest.createFunction(
  {
    id: "scheduler",
    name: "Send the digests that are due",
    /*
     * On the hour, every hour; at once when a digest is scheduled; and by hand, with no data, as
     * the dev server's Invoke button (and danwo's time travel) runs it.
     */
    triggers: [cron("0 * * * *"), DigestScheduled, invoke(z.object({}))],
    retries: 4,
  },
  async ({ step, runId }) => {
    const claimed = await step.run("claim due digests", () => claimDue(runId, new Date()))

    for (const digest of claimed)
      for (const [n, batch] of batches(digest.subscriberIds).entries()) {
        const number = n + 1

        await step.sendEvent(
          `send ${digest.id} batch ${number}`,
          batch.map((subscriberId) =>
            SendOne.create(
              { digestId: digest.id, subscriberId },
              { id: `send-${digest.id}-${subscriberId}` },
            ),
          ),
        )
        await step.sendEvent(
          `bill ${digest.id} batch ${number}`,
          Charge.create(
            { digestId: digest.id, batch: number, quantity: batch.length },
            { id: `charge-${digest.id}-${number}` },
          ),
        )
      }

    return { claimed: claimed.map((digest) => digest.id) }
  },
)

/** What sending one email came to, as the step remembers it. */
interface Sent {
  readonly emailId: string
  readonly tries: number
  readonly to: string
}

/**
 * Renders and sends one subscriber's copy. A try that fails, but may work next time, is noted in
 * the run history before Inngest tries again.
 */
async function deliver(digestId: string, subscriberId: string, attempt: number): Promise<Sent> {
  const delivery = await deliveryOf(digestId, subscriberId)
  const hello = delivery.name ? `Hi ${delivery.name},` : "Hi,"

  try {
    const emailId = await sendEmail({
      to: delivery.name ? `${delivery.name} <${delivery.email}>` : delivery.email,
      subject: delivery.title,
      text: `${hello}\n\n${delivery.intro}\n\nNorthwind Digest`,
      html: `<p>${hello}</p><p>${delivery.intro}</p><p>Northwind Digest</p>`,
      key: `digest-${digestId}-${subscriberId}`,
    })

    return { emailId, tries: attempt + 1, to: delivery.email }
  } catch (error) {
    if (!(error instanceof NonRetriableError))
      await note({
        key: `send-one ${digestId} ${subscriberId} try ${attempt + 1}`,
        digestId,
        job: "send-one",
        status: "retried",
        detail: `${delivery.email}: ${describe(error)}`,
        attempt: attempt + 1,
      }).catch(() => undefined)
    throw error
  }
}

export const sendOne = inngest.createFunction(
  {
    id: "send-one",
    name: "Send one digest email",
    triggers: [SendOne],
    retries: 3,
    onFailure: async ({ event, error, step }) => {
      const { digestId, subscriberId } = SendOne.schema.parse(event.data.event.data)
      const why = error.message

      await step.run("mark the delivery failed", () => recordFailed(digestId, subscriberId, why))

      const delivery = await step.run("tell the owner", async () => {
        const found = await deliveryOf(digestId, subscriberId)

        await sendEmail({
          to: found.ownerEmail,
          subject: `Couldn't deliver "${found.title}" to ${found.email}`,
          text: `"${found.title}" did not reach ${found.email}.\n\n${why}`,
          html: `<p>"${found.title}" did not reach ${found.email}.</p><p>${why}</p>`,
          key: `failed-${digestId}-${subscriberId}`,
        })

        return found
      })

      await step.run("note the owner was told", () =>
        recordOwnerTold(
          digestId,
          subscriberId,
          `Couldn't deliver to ${delivery.email}: ${why.replace(/\.$/, "")}. Told ${delivery.ownerEmail}.`,
        ),
      )
    },
  },
  async ({ event, step, attempt }) => {
    const { digestId, subscriberId } = event.data

    const sent = broken("no-step")
      ? await deliver(digestId, subscriberId, attempt)
      : await step.run("send the email", () => deliver(digestId, subscriberId, attempt))

    await step.run("record the delivery", () => recordSent(digestId, subscriberId, sent))

    return sent
  },
)

export const charge = inngest.createFunction(
  { id: "charge", name: "Bill a batch of emails", triggers: [Charge], retries: 4 },
  async ({ event, step }) => {
    const { digestId, batch, quantity } = event.data
    const billed = await step.run("bill the batch", async () =>
      billBatch({ digestId, batch, quantity, title: await titleOf(digestId) }),
    )

    await step.run("record the charge", () =>
      recordCharge({ digestId, batch, quantity, ...billed }),
    )

    return billed
  },
)

export const functions = [scheduler, sendOne, charge]
