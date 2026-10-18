import type { SessionJSON } from "@clerk/backend"

import type { App } from "../../http.ts"
import { bodyOf } from "../backend-auth.ts"
import { type ClerkContext, now } from "../context.ts"
import { ClerkFailure, invalidParameter, notFound, str } from "../helpers.ts"
import { endSession, isLive, newClient, sessionClaims, startSession } from "../sessions.ts"
import { templateClaims } from "../templates.ts"
import { userOf } from "./users.ts"

/** A session by id, or 404. */
function sessionOf(context: ClerkContext, id: string): SessionJSON {
  const session = context.clerk.sessions.get(id)

  if (!session) throw notFound("session")

  return session
}

/** A live session, or Clerk's 422 for asking a token of one that ended. */
function liveSessionOf(context: ClerkContext, id: string): SessionJSON {
  const session = sessionOf(context, id)

  if (!isLive(context, session))
    throw new ClerkFailure(
      422,
      "session_not_active",
      "Session is not active",
      `The session with id ${id} is not active, its status is ${session.status}.`,
    )

  return session
}

/** Sessions matching a list call's `user_id`, `client_id` and `status`. */
function listed(context: ClerkContext, query: (name: string) => string | undefined): SessionJSON[] {
  const userId = query("user_id")
  const clientId = query("client_id")
  const status = query("status")

  return context.clerk.sessions.where(
    (s) =>
      (userId === undefined || s.user_id === userId) &&
      (clientId === undefined || s.client_id === clientId) &&
      (status === undefined || s.status === status),
  )
}

/** A token for a session: the plain session token, or one shaped by a JWT template. */
function tokenFor(context: ClerkContext, session: SessionJSON, template: string | undefined) {
  const base = sessionClaims(context, session, undefined)
  const claims =
    template === undefined ? base : templateClaims(context, template, session, base)

  return { object: "token", jwt: context.key.sign(claims) }
}

function readRoutes(app: App, context: ClerkContext): void {
  app.get("/v1/sessions", (c) => {
    if (c.req.query("user_id") === undefined && c.req.query("client_id") === undefined)
      throw invalidParameter("user_id", "Either user_id or client_id is required.")

    return c.json(listed(context, (name) => c.req.query(name)))
  })
  app.get("/v1/sessions/:id", (c) => c.json(sessionOf(context, c.req.param("id"))))
}

function writeRoutes(app: App, context: ClerkContext): void {
  app.post("/v1/sessions", async (c) => {
    const userId = str((await bodyOf(c)).user_id)

    if (userId === undefined) throw invalidParameter("user_id")

    return c.json(startSession(context, newClient(context), userOf(context, userId).id))
  })
  app.post("/v1/sessions/:id/revoke", (c) => c.json(endSession(context, c.req.param("id"), "revoked")))
  app.post("/v1/sessions/:id/verify", (c) => c.json(liveSessionOf(context, c.req.param("id"))))
  app.post("/v1/sessions/:id/tokens", (c) =>
    c.json(tokenFor(context, liveSessionOf(context, c.req.param("id")), undefined)),
  )
  app.post("/v1/sessions/:id/tokens/:template", (c) =>
    c.json(tokenFor(context, liveSessionOf(context, c.req.param("id")), c.req.param("template"))),
  )
  app.post("/v1/sessions/:id/touch", (c) => {
    const session = liveSessionOf(context, c.req.param("id"))

    return c.json(context.clerk.sessions.change(session.id, { last_active_at: now(context) }))
  })
}

/** The Backend API's sessions: list, read, create, revoke, verify and mint tokens. */
export function sessionRoutes(app: App, context: ClerkContext): void {
  readRoutes(app, context)
  writeRoutes(app, context)
}
