/**
 * Inviting teammates. An admin invites an email address; the worker emails them a link; once they
 * sign in with that address and accept, they join the workspace's Clerk organization and Relay's
 * member list. Accepting twice, or after the Clerk membership exists, changes nothing.
 */
import { randomBytes } from "node:crypto"

import { and, eq } from "drizzle-orm"
import { Hono } from "hono"
import { z } from "zod"

import { query, transaction } from "../shared/db/client.ts"
import { invites, members, workspaces } from "../shared/db/schema.ts"
import { memberInvited } from "../shared/events.ts"
import { enqueue, flushSoon } from "../shared/outbox.ts"
import { clerk, clerkCall, clerkCode } from "./clerk.ts"
import { ensureUser } from "./people.ts"
import { HttpError } from "./problems.ts"
import { adminOf, type SignedIn, signedIn } from "./session.ts"
import { WorkspaceId } from "./workspaces.ts"

const Invite = z.object({ email: z.email().transform((email) => email.toLowerCase()) })

/** The invitation with `token`, and its workspace; 404 when there is none. */
async function inviteOf(token: string) {
  const [row] = await query("read invite", (db) =>
    db
      .select({ invite: invites, workspace: workspaces })
      .from(invites)
      .innerJoin(workspaces, eq(workspaces.id, invites.workspaceId))
      .where(eq(invites.token, token)),
  )

  if (!row) throw new HttpError(404, "This invitation doesn't exist.")

  return row
}

/** Adds the user to the workspace's Clerk organization, unless they are in it already. */
async function joinOrganization(orgId: string, userId: string): Promise<void> {
  try {
    await clerkCall("add member", () =>
      clerk.organizations.createOrganizationMembership({
        organizationId: orgId,
        userId,
        role: "org:member",
      }),
    )
  } catch (error) {
    if (clerkCode(error) !== "already_a_member_in_organization") throw error
  }
}

export const invitesApi = new Hono<SignedIn>()
  .use(signedIn)
  .post("/workspaces/:id/invites", async (c) => {
    const { workspace } = await adminOf(c.var.userId, WorkspaceId.parse(c.req.param("id")))
    const { email } = Invite.parse(await c.req.json())

    await transaction("invite member", async (tx) => {
      await tx
        .insert(invites)
        .values({
          token: randomBytes(18).toString("base64url"),
          workspaceId: workspace.id,
          email,
          invitedBy: c.var.userId,
        })
        .onConflictDoNothing()

      const [invite] = await tx
        .select({ token: invites.token })
        .from(invites)
        .where(and(eq(invites.workspaceId, workspace.id), eq(invites.email, email)))

      if (invite)
        await enqueue(tx, {
          id: `invite-${invite.token}`,
          name: memberInvited.name,
          data: { token: invite.token },
        })
    })
    await flushSoon()

    return c.json({ invited: email }, 201)
  })
  .get("/invites/:token", async (c) => {
    const me = await ensureUser(c.var.userId)
    const { invite, workspace } = await inviteOf(c.req.param("token"))

    return c.json({
      workspace: { id: workspace.id, name: workspace.name },
      email: invite.email,
      accepted: invite.acceptedAt !== null,
      forYou: invite.email === me.email.toLowerCase(),
    })
  })
  .post("/invites/:token/accept", async (c) => {
    const me = await ensureUser(c.var.userId)
    const { invite, workspace } = await inviteOf(c.req.param("token"))

    if (invite.email !== me.email.toLowerCase())
      throw new HttpError(403, `This invitation is for ${invite.email}.`)
    if (!workspace.clerkOrgId) throw new HttpError(409, "This workspace isn't ready yet.")

    await joinOrganization(workspace.clerkOrgId, me.id)
    await transaction("accept invite", async (tx) => {
      await tx
        .insert(members)
        .values({ workspaceId: workspace.id, userId: me.id, role: "org:member" })
        .onConflictDoNothing()
      await tx
        .update(invites)
        .set({ acceptedAt: new Date() })
        .where(eq(invites.token, invite.token))
    })

    return c.json({ workspaceId: workspace.id })
  })
