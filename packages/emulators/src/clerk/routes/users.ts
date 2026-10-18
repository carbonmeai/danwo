import type { App, Context } from "../../http.ts"
import { bodyOf, pageOf, queryList } from "../backend-auth.ts"
import { type ClerkContext, now } from "../context.ts"
import { type ClerkUser, newUser, verifiedEmail } from "../entities.ts"
import { ClerkFailure, invalidParameter, notFound, record, str, strings } from "../helpers.ts"
import { endSession } from "../sessions.ts"

/** A user by id, or 404. */
export function userOf(context: ClerkContext, id: string): ClerkUser {
  const user = context.clerk.users.get(id)

  if (!user) throw notFound("user")

  return user
}

/** The user with `address` among their email addresses, if any. */
export function userByEmail(context: ClerkContext, address: string): ClerkUser | undefined {
  const wanted = address.toLowerCase()

  return context.clerk.users
    .all()
    .find((user) => user.email_addresses.some((e) => e.email_address.toLowerCase() === wanted))
}

/** Whether a user matches a list call's filters. */
function matches(c: Context, user: ClerkUser): boolean {
  const emails = queryList(c, "email_address").map((e) => e.toLowerCase())
  const ids = queryList(c, "user_id")
  const query = c.req.query("query")?.toLowerCase()
  const externalIds = queryList(c, "external_id")
  const addresses = user.email_addresses.map((e) => e.email_address.toLowerCase())

  if (emails.length > 0 && !addresses.some((a) => emails.includes(a))) return false
  if (ids.length > 0 && !ids.includes(user.id)) return false
  if (externalIds.length > 0 && !externalIds.includes(user.external_id ?? "")) return false
  if (query === undefined) return true

  const haystack = [user.first_name, user.last_name, user.username, ...addresses]

  return haystack.some((value) => value?.toLowerCase().includes(query) === true)
}

/** Users in the order a list call asks for: newest first unless `order_by=+created_at`. */
function ordered(c: Context, users: ClerkUser[]): ClerkUser[] {
  const ascending = (c.req.query("order_by") ?? "-created_at").startsWith("+")

  return users.toSorted((a, b) => (ascending ? 1 : -1) * (a.created_at - b.created_at))
}

/** A new user from a create call's body; at least one email address is required here. */
function createUser(context: ClerkContext, body: Record<string, unknown>): ClerkUser {
  const emails = strings(body.email_address)
  const password = str(body.password) ?? null

  if (emails.length === 0) throw invalidParameter("email_address", "email_address is required.")
  if (emails.some((address) => userByEmail(context, address)))
    throw new ClerkFailure(
      422,
      "form_identifier_exists",
      "That email address is taken. Please try another.",
      "That email address is taken. Please try another.",
      { param_name: "email_address" },
    )

  const user = newUser(
    {
      emails,
      firstName: str(body.first_name) ?? null,
      lastName: str(body.last_name) ?? null,
      username: str(body.username) ?? null,
      externalId: str(body.external_id) ?? null,
      hasPassword: password !== null,
      publicMetadata: record(body.public_metadata),
      privateMetadata: record(body.private_metadata),
      unsafeMetadata: record(body.unsafe_metadata),
    },
    now(context),
  )

  return context.clerk.users.add(user, { password })
}

/** The name and metadata fields an update call may change. */
function updates(body: Record<string, unknown>): Partial<ClerkUser> {
  const changes: Partial<ClerkUser> = {}

  for (const field of ["first_name", "last_name", "username", "external_id"] as const)
    if (field in body) changes[field] = str(body[field]) ?? null
  for (const field of ["public_metadata", "private_metadata", "unsafe_metadata"] as const)
    if (field in body) changes[field] = record(body[field])

  return changes
}

/** Merges `metadata` into a user's, as `PATCH /users/:id/metadata` does: null removes a key. */
function mergeMetadata(user: ClerkUser, body: Record<string, unknown>): Partial<ClerkUser> {
  const merge = (current: Record<string, unknown>, patch: unknown) =>
    Object.fromEntries(
      Object.entries({ ...current, ...record(patch) }).filter(([, value]) => value !== null),
    )

  return {
    public_metadata: merge(user.public_metadata, body.public_metadata),
    private_metadata: merge(user.private_metadata, body.private_metadata),
    unsafe_metadata: merge(user.unsafe_metadata, body.unsafe_metadata),
  }
}

/** Ends every live session of a user, as banning or deleting them does. */
function endSessionsOf(context: ClerkContext, userId: string): void {
  for (const session of context.clerk.sessions.where(
    (s) => s.user_id === userId && s.status === "active",
  ))
    endSession(context, session.id, "revoked")
}

function readRoutes(app: App, context: ClerkContext): void {
  app.get("/v1/users", (c) => {
    const { limit, offset } = pageOf(c)

    return c.json(ordered(c, context.clerk.users.where((u) => matches(c, u))).slice(offset, offset + limit))
  })
  app.get("/v1/users/count", (c) =>
    c.json({ object: "total_count", total_count: context.clerk.users.where((u) => matches(c, u)).length }),
  )
  app.get("/v1/users/:id", (c) => c.json(userOf(context, c.req.param("id"))))
}

function writeRoutes(app: App, context: ClerkContext): void {
  app.post("/v1/users", async (c) => c.json(createUser(context, await bodyOf(c))))
  app.patch("/v1/users/:id", async (c) => {
    const user = userOf(context, c.req.param("id"))
    const changed = { ...updates(await bodyOf(c)), updated_at: now(context) }

    return c.json(context.clerk.users.change(user.id, changed))
  })
  app.patch("/v1/users/:id/metadata", async (c) => {
    const user = userOf(context, c.req.param("id"))

    return c.json(
      context.clerk.users.change(user.id, { ...mergeMetadata(user, await bodyOf(c)), updated_at: now(context) }),
    )
  })
  app.delete("/v1/users/:id", (c) => {
    const user = userOf(context, c.req.param("id"))

    endSessionsOf(context, user.id)
    context.clerk.users.remove(user.id)

    return c.json({ object: "user", id: user.id, slug: null, deleted: true })
  })
}

function accountRoutes(app: App, context: ClerkContext): void {
  for (const [path, banned] of [
    ["ban", true],
    ["unban", false],
  ] as const)
    app.post(`/v1/users/:id/${path}`, (c) => {
      const user = userOf(context, c.req.param("id"))

      if (banned) endSessionsOf(context, user.id)

      return c.json(context.clerk.users.change(user.id, { banned, updated_at: now(context) }))
    })
  app.post("/v1/users/:id/verify_password", async (c) => {
    const user = userOf(context, c.req.param("id"))
    const given = str((await bodyOf(c)).password)

    if (given === undefined || context.clerk.users.extra(user.id)?.password !== given)
      throw new ClerkFailure(422, "incorrect_password", "Password is incorrect.", "Password is incorrect.")

    return c.json({ verified: true })
  })
  app.post("/v1/users/:id/email_addresses", async (c) => {
    const user = userOf(context, c.req.param("id"))
    const address = str((await bodyOf(c)).email_address)

    if (address === undefined) throw invalidParameter("email_address")

    const email = verifiedEmail(address)

    context.clerk.users.change(user.id, { email_addresses: [...user.email_addresses, email] })

    return c.json(email)
  })
}

/** The Backend API's users: list, count, read, create, update, metadata, ban, delete. */
export function userRoutes(app: App, context: ClerkContext): void {
  readRoutes(app, context)
  writeRoutes(app, context)
  accountRoutes(app, context)
}
