/**
 * Who is asking. The web app forwards the browser's Clerk session token; the API checks it with
 * Clerk's public key, then checks the user belongs to the workspace a route names.
 */
import { and, eq } from "drizzle-orm"
import { createMiddleware } from "hono/factory"

import { query } from "../shared/db/client.ts"
import { members, workspaces } from "../shared/db/schema.ts"
import { userIdOf } from "./clerk.ts"
import { HttpError } from "./problems.ts"

/** What the signed-in routes know about the request. */
export interface SignedIn {
  readonly Variables: { readonly userId: string }
}

/** Refuses a request without a valid session token; otherwise notes whose it is. */
export const signedIn = createMiddleware<SignedIn>(async (c, next) => {
  const userId = await userIdOf(c.req.header("authorization"))

  if (!userId) return c.json({ error: "Sign in first." }, 401)

  c.set("userId", userId)
  await next()
})

/** The workspace `workspaceId` and the user's role in it; 404 unless they are a member. */
export async function membershipOf(userId: string, workspaceId: string) {
  const [row] = await query("read membership", (db) =>
    db
      .select({ workspace: workspaces, role: members.role })
      .from(members)
      .innerJoin(workspaces, eq(workspaces.id, members.workspaceId))
      .where(and(eq(members.userId, userId), eq(members.workspaceId, workspaceId))),
  )

  if (!row) throw new HttpError(404, "No such workspace.")

  return row
}

/** As `membershipOf`, and 403 unless the user is one of the workspace's admins. */
export async function adminOf(userId: string, workspaceId: string) {
  const row = await membershipOf(userId, workspaceId)

  if (row.role !== "org:admin") throw new HttpError(403, "Only an admin can do that.")

  return row
}
