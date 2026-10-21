/**
 * Stripe's and Clerk's webhooks. A delivery's signature is checked first, and a forged or stale one
 * changes nothing. What an event means is then read from Stripe itself (the subscription as it is
 * now), so a late or repeated delivery can't put an old status back; the jobs an event starts are
 * queued with the event logged, in one transaction, so each starts once. Anything that fails
 * answers 500, and the provider delivers again later.
 */
import { verifyWebhook } from "@clerk/backend/webhooks"
import { Hono } from "hono"
import type { Stripe } from "stripe"

import { broken } from "../shared/bugs.ts"
import { transaction } from "../shared/db/client.ts"
import { webhookEvents } from "../shared/db/schema.ts"
import { invoicePaid, paymentFailed, trialEnding } from "../shared/events.ts"
import { enqueue, flushSoon, type Job } from "../shared/outbox.ts"
import { applySetup } from "./billing.ts"
import { fullName, rememberUser } from "./people.ts"
import { settings } from "./settings.ts"
import { stripe } from "./stripe.ts"
import { syncSubscription } from "./subscriptions.ts"

/** The verified event a delivery carries, or undefined when its signature does not check out. */
function verified(body: string, signature: string | undefined): Stripe.Event | undefined {
  try {
    return stripe.webhooks.constructEvent(body, signature ?? "", settings.STRIPE_WEBHOOK_SECRET)
  } catch {
    return undefined
  }
}

/**
 * Logs `event` and queues `jobs` in one transaction, unless the event was logged before. With
 * SAAS_BUG=no-webhook-dedupe nothing is logged, and every delivery queues its jobs again.
 */
async function once(event: Stripe.Event, jobs: readonly Job[]): Promise<void> {
  await transaction(`log ${event.type}`, async (tx) => {
    if (!broken("no-webhook-dedupe")) {
      const [first] = await tx
        .insert(webhookEvents)
        .values({ id: `stripe:${event.id}`, type: event.type })
        .onConflictDoNothing()
        .returning({ id: webhookEvents.id })

      if (!first) return
    }

    for (const job of jobs) await enqueue(tx, job)
  })
  /* Also for a repeat: the first delivery's jobs may still wait in the outbox. */
  await flushSoon()
}

/** The subscription an invoice bills, if any. */
function subscriptionOf(invoice: Stripe.Invoice): string | undefined {
  const id = invoice.parent?.subscription_details?.subscription

  return typeof id === "string" ? id : id?.id
}

/** The workspace an invoice's subscription belongs to, after saving that subscription afresh. */
async function syncInvoice(invoice: Stripe.Invoice): Promise<string | undefined> {
  const id = subscriptionOf(invoice)

  return id ? (await syncSubscription(id)).metadata.workspace_id : undefined
}

/** Acts on one Stripe event: what it changes, then the jobs it starts. */
async function handle(event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
      await syncSubscription(event.data.object.id)

      return once(event, [])
    case "customer.subscription.trial_will_end": {
      const subscription = await syncSubscription(event.data.object.id)
      const workspaceId = subscription.metadata.workspace_id

      return once(
        event,
        workspaceId && subscription.trial_end
          ? [
              {
                id: `trial-ending-${event.id}`,
                name: trialEnding.name,
                data: { workspaceId, trialEnd: subscription.trial_end },
              },
            ]
          : [],
      )
    }
    case "invoice.paid": {
      const invoice = event.data.object
      const workspaceId = await syncInvoice(invoice)

      /* A trial's first invoice is for nothing: no receipt for that. */
      return once(
        event,
        workspaceId && invoice.amount_paid > 0 && invoice.id
          ? [
              {
                id: `invoice-paid-${invoice.id}`,
                name: invoicePaid.name,
                data: { workspaceId, invoiceId: invoice.id },
              },
            ]
          : [],
      )
    }
    case "invoice.payment_failed": {
      const invoice = event.data.object
      const workspaceId = await syncInvoice(invoice)

      return once(
        event,
        workspaceId && invoice.id
          ? [
              {
                id: `payment-failed-${invoice.id}-${invoice.attempt_count}`,
                name: paymentFailed.name,
                data: { workspaceId, invoiceId: invoice.id },
              },
            ]
          : [],
      )
    }
    case "checkout.session.completed":
      if (event.data.object.mode === "setup") await applySetup(event.data.object.id)

      return once(event, [])
    default:
      return undefined
  }
}

export const webhooks = new Hono()
  .post("/webhooks/stripe", async (c) => {
    const event = verified(await c.req.text(), c.req.header("stripe-signature"))

    if (!event) return c.json({ error: "bad signature" }, 400)

    await handle(event)

    return c.json({ received: true })
  })
  .post("/webhooks/clerk", async (c) => {
    const event = await verifyWebhook(c.req.raw, {
      signingSecret: settings.CLERK_WEBHOOK_SIGNING_SECRET,
    }).catch(() => undefined)

    if (!event) return c.json({ error: "bad signature" }, 400)

    if (event.type === "user.created") {
      const user = event.data
      const email =
        user.email_addresses.find((address) => address.id === user.primary_email_address_id) ??
        user.email_addresses[0]

      /* The same as a first signed-in request does, so whichever comes first, it happens once. */
      if (email)
        await rememberUser({
          id: user.id,
          email: email.email_address,
          name: fullName(user.first_name, user.last_name),
        })
    }

    return c.json({ received: true })
  })
