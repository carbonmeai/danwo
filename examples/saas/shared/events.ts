/**
 * The background jobs Relay starts, as Inngest events, and the one Inngest client the API and the
 * worker share. The API never sends these directly: it writes them to the outbox in the same
 * transaction as what caused them (see `shared/outbox.ts`), so a job is never lost to a crash
 * between the write and the send, and never started twice for one cause.
 */
import { eventType, Inngest } from "inngest"
import { z } from "zod"

export const inngest = new Inngest({ id: "relay" })

/** Someone signed up: the welcome email. */
export const userSignedUp = eventType("user/signed-up", {
  schema: z.object({ userId: z.string(), email: z.string(), name: z.string().nullable() }),
})

/** A workspace is ready, with its trial running: the getting-started email. */
export const workspaceReady = eventType("workspace/ready", {
  schema: z.object({ workspaceId: z.string() }),
})

/** Someone was invited to a workspace: the invitation email. */
export const memberInvited = eventType("workspace/member.invited", {
  schema: z.object({ token: z.string() }),
})

/** A note was published: post it to the workspace's Slack channel. */
export const notePublished = eventType("note/published", {
  schema: z.object({ noteId: z.number() }),
})

/** Stripe says the trial ends in three days: the reminder. */
export const trialEnding = eventType("billing/trial.ending", {
  schema: z.object({ workspaceId: z.string(), trialEnd: z.number() }),
})

/** An invoice for money was paid: the receipt (and, for the first, the "you're subscribed" note). */
export const invoicePaid = eventType("billing/invoice.paid", {
  schema: z.object({ workspaceId: z.string(), invoiceId: z.string() }),
})

/** A payment failed: ask the owner to update the card. */
export const paymentFailed = eventType("billing/payment.failed", {
  schema: z.object({ workspaceId: z.string(), invoiceId: z.string() }),
})

/** Every event the outbox may hold, by name. */
export const EVENTS = {
  [userSignedUp.name]: userSignedUp,
  [workspaceReady.name]: workspaceReady,
  [memberInvited.name]: memberInvited,
  [notePublished.name]: notePublished,
  [trialEnding.name]: trialEnding,
  [invoicePaid.name]: invoicePaid,
  [paymentFailed.name]: paymentFailed,
} as const

export type EventName = keyof typeof EVENTS
