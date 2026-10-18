import { asRecord, isRecord } from "../../json.ts"
import type { Auth0RouteContext } from "../context.ts"
import type { Auth0UserRecord } from "../entities.ts"
import { hashPassword, jsonBody, ManagementError } from "../helpers.ts"
import { managedUser, paged, requireScope } from "../management.ts"
import { userQuery } from "../search.ts"
import { insertUser, userView } from "../users.ts"

type Fields = Record<string, unknown>

const text = (value: unknown) => (typeof value === "string" ? value : undefined)
const flag = (value: unknown) => (typeof value === "boolean" ? value : undefined)

/** Merges metadata the way the Management API does: keys set to null are removed. */
function mergeMetadata(current: Record<string, unknown>, patch: unknown): Record<string, unknown> {
  if (!isRecord(patch)) return current

  const merged = { ...current, ...patch }

  for (const [key, value] of Object.entries(patch)) if (value === null) delete merged[key]

  return merged
}

const missing = (property: string) =>
  new ManagementError(
    400,
    `Payload validation error: 'Missing required property: ${property}'.`,
    "invalid_body",
  )

/** The new user's email, once the body names one and a connection, and the email is free. */
function newUserEmail(context: Auth0RouteContext, tenant: string, body: Fields): string {
  const email = text(body.email)?.toLowerCase()

  if (!email) throw missing("email")
  if (!text(body.connection)) throw missing("connection")
  if (
    context
      .auth0()
      .users.findBy("email", email)
      .some((found) => found.tenant === tenant)
  )
    throw new ManagementError(409, "The user already exists.", "auth0_idp_error")

  return email
}

function createUser(context: Auth0RouteContext, tenant: string, body: Fields): Auth0UserRecord {
  const email = newUserEmail(context, tenant, body)
  const name = text(body.name)

  return insertUser(context.auth0(), tenant, {
    email,
    password: text(body.password) ?? null,
    ...(name !== undefined && { name }),
    email_verified: flag(body.email_verified) ?? false,
    blocked: flag(body.blocked) ?? false,
    app_metadata: asRecord(body.app_metadata) ?? {},
    user_metadata: asRecord(body.user_metadata) ?? {},
  })
}

function patchUser(
  context: Auth0RouteContext,
  user: Auth0UserRecord,
  body: Fields,
): Auth0UserRecord {
  const changes: Partial<Auth0UserRecord> = {
    app_metadata: mergeMetadata(user.app_metadata, body.app_metadata),
    user_metadata: mergeMetadata(user.user_metadata, body.user_metadata),
  }
  const [email, name, nickname, password] = [
    body.email,
    body.name,
    body.nickname,
    body.password,
  ].map(text)
  const [verified, blocked] = [body.email_verified, body.blocked].map(flag)

  if (email !== undefined) changes.email = email.toLowerCase()
  if (name !== undefined) changes.name = name
  if (nickname !== undefined) changes.nickname = nickname
  if (verified !== undefined) changes.email_verified = verified
  if (blocked !== undefined) changes.blocked = blocked
  if (password !== undefined) changes.passwordHash = hashPassword(password)

  return context.auth0().users.update(user.id, changes) ?? user
}

function deleteUser(context: Auth0RouteContext, user: Auth0UserRecord): void {
  const auth0 = context.auth0()

  for (const link of auth0.userRoles.findBy("user_id", user.user_id))
    auth0.userRoles.delete(link.id)
  for (const token of auth0.refreshTokens.all().filter((found) => found.user_id === user.user_id))
    auth0.refreshTokens.delete(token.id)

  auth0.users.delete(user.id)
}

function userListRoutes(context: Auth0RouteContext): void {
  const { app } = context

  app.get("/api/v2/users", (c) => {
    const { tenant } = requireScope(c, "read:users")
    const filter = userQuery(c.req.query("q"))
    const users = context
      .auth0()
      .users.all()
      .filter((user) => user.tenant === tenant.domain && filter(user))

    return paged(c, "users", users.map(userView))
  })

  app.get("/api/v2/users-by-email", (c) => {
    const { tenant } = requireScope(c, "read:users")
    const email = (c.req.query("email") ?? "").toLowerCase()

    return c.json(
      context
        .auth0()
        .users.findBy("email", email)
        .filter((user) => user.tenant === tenant.domain)
        .map(userView),
    )
  })

  app.post("/api/v2/users", async (c) => {
    const { tenant } = requireScope(c, "create:users")

    return c.json(userView(createUser(context, tenant.domain, await jsonBody(c))), 201)
  })
}

function userItemRoutes(context: Auth0RouteContext): void {
  const { app } = context

  app.get("/api/v2/users/:id", (c) => {
    const { tenant } = requireScope(c, "read:users")

    return c.json(userView(managedUser(context, tenant.domain, c.req.param("id"))))
  })

  app.patch("/api/v2/users/:id", async (c) => {
    const { tenant } = requireScope(c, "update:users")

    return c.json(
      userView(
        patchUser(
          context,
          managedUser(context, tenant.domain, c.req.param("id")),
          await jsonBody(c),
        ),
      ),
    )
  })

  app.delete("/api/v2/users/:id", (c) => {
    const { tenant } = requireScope(c, "delete:users")

    deleteUser(context, managedUser(context, tenant.domain, c.req.param("id")))

    return c.body(null, 204)
  })
}

/** Brute-force blocks: listing them, and lifting a user's block. */
function blockRoutes(context: Auth0RouteContext): void {
  const { app } = context

  app.get("/api/v2/user-blocks/:id", (c) => {
    const { tenant } = requireScope(c, "read:users")
    const user = managedUser(context, tenant.domain, c.req.param("id"))

    return c.json({ blocked_for: user.blocked ? [{ identifier: user.email, ip: "0.0.0.0" }] : [] })
  })

  app.delete("/api/v2/user-blocks/:id", (c) => {
    const { tenant } = requireScope(c, "update:users")
    const user = managedUser(context, tenant.domain, c.req.param("id"))

    context.auth0().users.update(user.id, { blocked: false })

    return c.body(null, 204)
  })
}

/** The Management API's users: search, create, read, update, delete, and their blocks. */
export function userRoutes(context: Auth0RouteContext): void {
  for (const register of [userListRoutes, userItemRoutes, blockRoutes]) register(context)
}
