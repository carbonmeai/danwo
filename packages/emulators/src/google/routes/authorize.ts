import type { Context } from "../../http.ts"
import { type AuthorizeParams, authorizeParams } from "../../oauth/pkce.ts"
import {
  completeSignIn,
  parkRequest,
  renderChooser,
  renderProblem,
} from "../../oauth/sign-in-page.ts"
import type { GoogleRouteContext } from "../context.ts"
import { CHOOSER_ACTION, grantedScope } from "../helpers.ts"

/** Google's error page for a request that names the wrong client or redirect URI. */
function blocked(c: Context, status: number, error: string, detail: string): Response {
  return c.html(
    renderProblem("Access blocked: Authorization Error", `Error ${status}: ${error}. ${detail}`),
    status,
  )
}

/** Checks the client and its exact redirect URI before anything else, as Google does. */
function checkClient(
  c: Context,
  context: GoogleRouteContext,
  params: AuthorizeParams,
): Response | undefined {
  const client = context.google().clients.findOneBy("client_id", params.client_id)

  if (!client) return blocked(c, 401, "invalid_client", "The OAuth client was not found.")
  if (!client.redirect_uris.includes(params.redirect_uri))
    return blocked(
      c,
      400,
      "redirect_uri_mismatch",
      `The redirect URI ${params.redirect_uri} is not registered for this client.`,
    )

  return undefined
}

/** The authorization endpoint and Google's account chooser. */
export function authorizeRoutes(context: GoogleRouteContext): void {
  const { app, clock } = context

  const authorize = (c: Context) => {
    const query = new URL(c.req.url).searchParams
    const params = {
      ...authorizeParams(query, { offline: query.get("access_type") === "offline", tenant: "" }),
      incremental: query.get("include_granted_scopes") === "true",
    }
    const refused = checkClient(c, context, params)

    if (refused) return refused

    const google = context.google()
    const client = google.clients.findOneBy("client_id", params.client_id)

    return c.html(
      renderChooser({
        title: "Choose an account",
        subtitle: `to continue to ${client?.name ?? "the app"}`,
        action: CHOOSER_ACTION,
        requestId: parkRequest(google, params),
        accounts: google.users
          .all()
          .map((user) => ({ id: user.uid, name: user.name, email: user.email })),
      }),
    )
  }

  app.get("/o/oauth2/v2/auth", authorize)
  app.get("/o/oauth2/auth", authorize)

  app.post(CHOOSER_ACTION, (c) => {
    const google = context.google()

    return completeSignIn(c, {
      tables: google,
      clock,
      accept: (uid) => google.users.findOneBy("uid", uid)?.uid,
      extras: (params) => ({ scope: grantedScope(params.scope), authuser: "0", prompt: "consent" }),
      denied: { error: "access_denied" },
    })
  })
}
