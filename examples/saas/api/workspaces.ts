/**
 * The signed-in user's workspaces: the list the switcher shows, onboarding a new one, and one
 * workspace's overview with its members, usage and integrations.
 */
import { and, asc, count, eq, gte, isNotNull, isNull, sql } from "drizzle-orm"
import { Hono } from "hono"
import { z } from "zod"

import { query } from "../shared/db/client.ts"
import { integrations, invites, members, notes, users, workspaces } from "../shared/db/schema.ts"
import { planOf } from "../shared/plans.ts"
import { onboard } from "./onboarding.ts"
import { ensureUser } from "./people.ts"
import { membershipOf, type SignedIn, signedIn } from "./session.ts"

export const WorkspaceId = z.uuid()

const NewWorkspace = z.object({
  /** The person's own name, which the sign-up form doesn't ask for. */
  yourName: z.string().trim().min(1).max(80),
  name: z.string().trim().min(2).max(60),
  onboardingKey: z.string().min(8).max(100),
})

/** The start of the calendar month `now` is in, for the notes-this-month meter. */
function monthStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
}

/** How much of its plan a workspace uses: members and notes this month, against the limits. */
async function usageOf(workspaceId: string, plan: string) {
  const limits = planOf(plan)
  const [people] = await query("count members", (db) =>
    db.select({ n: count() }).from(members).where(eq(members.workspaceId, workspaceId)),
  )
  const [written] = await query("count notes", (db) =>
    db
      .select({ n: count() })
      .from(notes)
      .where(
        and(
          eq(notes.workspaceId, workspaceId),
          isNotNull(notes.publishedAt),
          gte(notes.publishedAt, monthStart(new Date())),
        ),
      ),
  )

  return {
    members: { used: people?.n ?? 0, limit: limits.members },
    notes: { used: written?.n ?? 0, limit: limits.notesPerMonth },
  }
}

export const workspacesApi = new Hono<SignedIn>()
  .use(signedIn)
  .get("/me", async (c) => {
    const me = await ensureUser(c.var.userId)
    const mine = await query("list workspaces", (db) =>
      db
        .select({
          id: workspaces.id,
          name: workspaces.name,
          role: members.role,
          status: workspaces.subscriptionStatus,
          ready: sql<boolean>`${workspaces.readyAt} is not null`,
        })
        .from(members)
        .innerJoin(workspaces, eq(workspaces.id, members.workspaceId))
        .where(eq(members.userId, me.id))
        .orderBy(asc(workspaces.createdAt)),
    )
    const invited = await query("list invites", (db) =>
      db
        .select({ token: invites.token, workspace: workspaces.name })
        .from(invites)
        .innerJoin(workspaces, eq(workspaces.id, invites.workspaceId))
        .where(and(eq(invites.email, me.email), isNull(invites.acceptedAt))),
    )

    return c.json({ me, workspaces: mine, invites: invited })
  })
  .post("/workspaces", async (c) => {
    const form = NewWorkspace.parse(await c.req.json())
    const id = await onboard(c.var.userId, {
      name: form.yourName,
      workspace: form.name,
      key: form.onboardingKey,
    })

    return c.json({ id }, 201)
  })
  .get("/workspaces/:id", async (c) => {
    const { workspace, role } = await membershipOf(
      c.var.userId,
      WorkspaceId.parse(c.req.param("id")),
    )
    const people = await query("list members", (db) =>
      db
        .select({ id: users.id, name: users.name, email: users.email, role: members.role })
        .from(members)
        .innerJoin(users, eq(users.id, members.userId))
        .where(eq(members.workspaceId, workspace.id))
        .orderBy(asc(members.joinedAt)),
    )
    const pending = await query("list pending invites", (db) =>
      db
        .select({ email: invites.email })
        .from(invites)
        .where(and(eq(invites.workspaceId, workspace.id), isNull(invites.acceptedAt))),
    )
    const connected = await query("list integrations", (db) =>
      db
        .select({
          provider: integrations.provider,
          status: integrations.status,
          account: integrations.externalName,
          channel: integrations.channelName,
        })
        .from(integrations)
        .where(eq(integrations.workspaceId, workspace.id)),
    )

    return c.json({
      workspace: {
        id: workspace.id,
        name: workspace.name,
        plan: workspace.plan,
        status: workspace.subscriptionStatus,
        trialEndsAt: workspace.trialEndsAt,
        currentPeriodEnd: workspace.currentPeriodEnd,
        hasPaymentMethod: workspace.hasPaymentMethod,
        ready: workspace.readyAt !== null,
      },
      role,
      members: people,
      invites: pending,
      integrations: connected,
      usage: await usageOf(workspace.id, workspace.plan),
    })
  })
