/**
 * Relay's background jobs. Each runs as one Inngest step, which Inngest retries when it throws;
 * each is safe to retry: emails carry a key named after their job (see `mail.ts`), and the Slack
 * post looks for itself before posting (see `slack-post.ts`).
 */
import { eq } from "drizzle-orm"

import { query } from "../shared/db/client.ts"
import { invites, users, workspaces } from "../shared/db/schema.ts"
import {
  inngest,
  invoicePaid,
  memberInvited,
  notePublished,
  paymentFailed,
  trialEnding,
  userSignedUp,
  workspaceReady,
} from "../shared/events.ts"
import { dollars, planOf } from "../shared/plans.ts"
import { send } from "./mail.ts"
import { settings } from "./settings.ts"
import { postNote } from "./slack-post.ts"

/** How often Inngest tries a job before giving up on it. */
const RETRIES = 6

/** A workspace and its owner, for the billing emails. */
async function ownerOf(workspaceId: string) {
  const [row] = await query("read workspace owner", (db) =>
    db
      .select({ workspace: workspaces, owner: users })
      .from(workspaces)
      .innerJoin(users, eq(users.id, workspaces.ownerId))
      .where(eq(workspaces.id, workspaceId)),
  )

  if (!row) throw new Error(`no workspace ${workspaceId}`)

  return row
}

/** `Tuesday, 4 November` for a Date. */
function day(date: Date): string {
  return date.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })
}

const welcome = inngest.createFunction(
  { id: "send-welcome-email", retries: RETRIES, triggers: [userSignedUp] },
  async ({ event, step }) =>
    step.run("send the welcome email", () =>
      send({
        kind: "welcome",
        key: `welcome/${event.id ?? event.data.userId}`,
        to: event.data.email,
        subject: "Welcome to Relay",
        lines: [
          `Hi ${event.data.name ?? "there"},`,
          "Relay keeps your team in the loop: write a note, publish it, and everyone sees it at once, in Relay and in Slack.",
          "Start by creating a workspace for your team.",
        ],
        action: { label: "Create a workspace", url: `${settings.WEB_URL}/onboarding` },
      }),
    ),
)

const ready = inngest.createFunction(
  { id: "send-workspace-ready-email", retries: RETRIES, triggers: [workspaceReady] },
  async ({ event, step }) =>
    step.run("send the getting-started email", async () => {
      const { workspace, owner } = await ownerOf(event.data.workspaceId)

      return send({
        kind: "workspace-ready",
        key: `workspace-ready/${event.id ?? workspace.id}`,
        to: owner.email,
        subject: `${workspace.name} is ready: your trial has started`,
        lines: [
          `${workspace.name} is set up, with 14 days of the Team plan to try everything.`,
          "Three things to do first: invite a teammate, connect Slack, and publish your first note.",
        ],
        action: { label: "Open Relay", url: `${settings.WEB_URL}/w/${workspace.id}` },
      })
    }),
)

const invited = inngest.createFunction(
  { id: "send-invite-email", retries: RETRIES, triggers: [memberInvited] },
  async ({ event, step }) =>
    step.run("send the invitation", async () => {
      const [row] = await query("read invite", (db) =>
        db
          .select({ invite: invites, workspace: workspaces, by: users })
          .from(invites)
          .innerJoin(workspaces, eq(workspaces.id, invites.workspaceId))
          .innerJoin(users, eq(users.id, invites.invitedBy))
          .where(eq(invites.token, event.data.token)),
      )

      if (!row) return "no such invite"

      return send({
        kind: "invite",
        key: `invite/${event.id ?? row.invite.token}`,
        to: row.invite.email,
        subject: `${row.by.name ?? row.by.email} invited you to ${row.workspace.name} on Relay`,
        lines: [
          `${row.by.name ?? row.by.email} invited you to join ${row.workspace.name} on Relay, where the team shares its notes.`,
        ],
        action: {
          label: "Accept the invitation",
          url: `${settings.WEB_URL}/invites/${row.invite.token}`,
        },
      })
    }),
)

const posted = inngest.createFunction(
  { id: "post-note-to-slack", retries: RETRIES, triggers: [notePublished] },
  async ({ event, step }) => step.run("post to slack", () => postNote(event.data.noteId)),
)

const trialEnds = inngest.createFunction(
  { id: "send-trial-ending-email", retries: RETRIES, triggers: [trialEnding] },
  async ({ event, step }) =>
    step.run("send the reminder", async () => {
      const { workspace, owner } = await ownerOf(event.data.workspaceId)
      const plan = planOf(workspace.plan)

      return send({
        kind: "trial-ending",
        key: `trial-ending/${event.id ?? workspace.id}`,
        to: owner.email,
        subject: `Your Relay trial ends in 3 days`,
        lines: [
          `The trial for ${workspace.name} ends on ${day(new Date(event.data.trialEnd * 1000))}.`,
          workspace.hasPaymentMethod
            ? `You're all set: we'll start charging ${dollars(plan.priceCents)} a month for ${plan.name} then.`
            : `Add a card to keep ${plan.name} for ${dollars(plan.priceCents)} a month.`,
        ],
        action: {
          label: "Open billing",
          url: `${settings.WEB_URL}/w/${workspace.id}/settings/billing`,
        },
      })
    }),
)

const receipt = inngest.createFunction(
  { id: "send-receipt-email", retries: RETRIES, triggers: [invoicePaid] },
  async ({ event, step }) =>
    step.run("send the receipt", async () => {
      const { workspace, owner } = await ownerOf(event.data.workspaceId)
      const plan = planOf(workspace.plan)

      return send({
        kind: "receipt",
        key: `receipt/${event.id ?? event.data.invoiceId}`,
        to: owner.email,
        subject: `Receipt for ${workspace.name}: ${plan.name} plan`,
        lines: [
          `Thanks! ${workspace.name} is on the ${plan.name} plan.`,
          `Invoice ${event.data.invoiceId} is paid.`,
        ],
        action: {
          label: "See invoices",
          url: `${settings.WEB_URL}/w/${workspace.id}/settings/billing`,
        },
      })
    }),
)

const failed = inngest.createFunction(
  { id: "send-payment-failed-email", retries: RETRIES, triggers: [paymentFailed] },
  async ({ event, step }) =>
    step.run("ask for a new card", async () => {
      const { workspace, owner } = await ownerOf(event.data.workspaceId)

      return send({
        kind: "payment-failed",
        key: `payment-failed/${event.id ?? event.data.invoiceId}`,
        to: owner.email,
        subject: `We couldn't take payment for ${workspace.name}`,
        lines: [
          `Your card was declined for invoice ${event.data.invoiceId}.`,
          "Update the card to keep your workspace running.",
        ],
        action: {
          label: "Update the card",
          url: `${settings.WEB_URL}/w/${workspace.id}/settings/billing`,
        },
      })
    }),
)

export const functions = [welcome, ready, invited, posted, trialEnds, receipt, failed]
