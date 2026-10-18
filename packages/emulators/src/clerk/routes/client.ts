import type { SessionJSON } from "@clerk/backend"

import type { App, Context } from "../../http.ts"
import { bodyOf } from "../backend-auth.ts"
import { type BrowserRequest, browserRequest, currentClient, reply } from "../browser-request.ts"
import { type ClerkContext, instanceOf, now } from "../context.ts"
import { environmentJson } from "../environment.ts"
import { browserClient, browserSession } from "../frontend-json.ts"
import { devBrowserFor } from "../handshake.ts"
import { ClerkFailure, str } from "../helpers.ts"
import { endSession, isLive, sessionClaims } from "../sessions.ts"
import { templateClaims } from "../templates.ts"

/**
 * A live session on the request's client. Anything else is 401 `signed_out`: ClerkJS then
 * reloads the client and finds itself signed out, as it does when a session is revoked.
 */
function ownSession(context: ClerkContext, request: BrowserRequest, id: string): SessionJSON {
  const session = context.clerk.sessions.get(id)

  if (!session || session.client_id !== request.client.id || !isLive(context, session))
    throw new ClerkFailure(401, "signed_out", "Signed out", "You are signed out.")

  return session
}

/** `POST /v1/client/sessions/:id/tokens[/:template]`: a fresh session token for the app's origin. */
function token(c: Context, context: ClerkContext, template: string | undefined): Response {
  const request = browserRequest(c, context)
  const session = ownSession(context, request, c.req.param("id"))
  const base = sessionClaims(context, session, request.azp)
  const claims = template === undefined ? base : templateClaims(context, template, session, base)

  return c.json({ object: "token", jwt: context.key.sign(claims) })
}

/** Ends every session on the client, as signing out of all of them does. */
function signOut(c: Context, context: ClerkContext): Response {
  const request = browserRequest(c, context)

  for (const id of currentClient(context, request).session_ids) endSession(context, id, "ended")

  const client = browserClient(context, currentClient(context, request), request.azp)

  return c.json({ response: client, client })
}

/** The client: read, created, or signed out of. */
function clientRoutes(app: App, context: ClerkContext): void {
  const read = (c: Context) => {
    const request = browserRequest(c, context)

    return c.json({ response: browserClient(context, request.client, request.azp), client: null })
  }

  app.get("/v1/client", read)
  app.put("/v1/client", read)
  app.post("/v1/client", read)
  app.delete("/v1/client", (c) => signOut(c, context))
  app.delete("/v1/client/sessions", (c) => signOut(c, context))
}

/** The client's sessions: touched (and switched organization), tokens minted, ended. */
function sessionRoutes(app: App, context: ClerkContext): void {
  app.post("/v1/client/sessions/:id/touch", async (c) => {
    const request = browserRequest(c, context)
    const session = ownSession(context, request, c.req.param("id"))
    const body = await bodyOf(c)
    const org =
      body.active_organization_id === undefined
        ? {}
        : { last_active_organization_id: str(body.active_organization_id) ?? "" }
    const touched =
      context.clerk.sessions.change(session.id, { ...org, last_active_at: now(context) }) ?? session

    context.clerk.clients.change(request.client.id, {
      last_active_session_id: session.id,
      updated_at: now(context),
    })

    return reply(c, context, request, browserSession(context, touched, request.azp))
  })
  app.post("/v1/client/sessions/:id/tokens", (c) => token(c, context, undefined))
  app.post("/v1/client/sessions/:id/tokens/:template", (c) =>
    token(c, context, c.req.param("template")),
  )

  for (const action of ["end", "remove"] as const)
    app.post(`/v1/client/sessions/:id/${action}`, (c) => {
      const request = browserRequest(c, context)
      const ended = endSession(
        context,
        ownSession(context, request, c.req.param("id")).id,
        action === "end" ? "ended" : "removed",
      )

      return reply(c, context, request, browserSession(context, ended, request.azp))
    })
}

/**
 * The Frontend API ClerkJS runs on: a dev browser to stand in for third-party cookies, the
 * instance's settings, and the browser's client with its sessions and tokens.
 */
export function clientApiRoutes(app: App, context: ClerkContext): void {
  app.post("/v1/dev_browser", (c) =>
    c.json({ object: "dev_browser", id: devBrowserFor(context, undefined).id }),
  )
  app.get("/v1/environment", (c) => c.json(environmentJson(instanceOf(context))))
  app.patch("/v1/environment", (c) => c.json(environmentJson(instanceOf(context))))
  clientRoutes(app, context)
  sessionRoutes(app, context)
}
