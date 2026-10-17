import { randomUUID } from "node:crypto"

import type { Context } from "../../http.ts"
import { type AuthorizeParams, authorizeParams } from "../../oauth/pkce.ts"
import {
  completeSignIn,
  parkRequest,
  redirectToApp,
  renderChooser,
  renderProblem,
} from "../../oauth/sign-in-page.ts"
import type { MicrosoftRouteContext } from "../context.ts"
import { clientInfo } from "../formatters.ts"
import { tenantAllows } from "../helpers.ts"

/** Entra ID's sign-in error page, with the AADSTS code the real one shows. */
function signInError(c: Context, code: number, message: string): Response {
  return c.html(renderProblem("Sign in", `AADSTS${code}: ${message}`), 400)
}

/** The first problem with the request's client and redirect URI, as an error page. */
function checkClient(
  c: Context,
  context: MicrosoftRouteContext,
  params: AuthorizeParams,
): Response | undefined {
  const client = context.microsoft().clients.findOneBy("client_id", params.client_id)

  if (!client)
    return signInError(
      c,
      700016,
      `Application with identifier '${params.client_id}' was not found in the directory. This can happen if the application has not been installed by the administrator of the tenant or consented to by any user in the tenant.`,
    )
  if (!client.redirect_uris.includes(params.redirect_uri))
    return signInError(
      c,
      50011,
      `The redirect URI '${params.redirect_uri}' specified in the request does not match the redirect URIs configured for the application '${params.client_id}'.`,
    )

  return undefined
}

/** The v2.0 authorization endpoint per tenant path, the account picker, and sign-out. */
export function authorizeRoutes(context: MicrosoftRouteContext): void {
  const { app, clock } = context

  app.get("/:tenant/oauth2/v2.0/authorize", (c) => {
    const tenant = c.req.param("tenant")
    const query = new URL(c.req.url).searchParams
    const params = authorizeParams(query, {
      offline: (query.get("scope") ?? "").split(/\s+/).includes("offline_access"),
      tenant,
    })
    const refused = checkClient(c, context, params)

    if (refused) return refused
    if (!params.scope.trim())
      return redirectToApp(c, params, {
        error: "invalid_request",
        error_description:
          "AADSTS900144: The request body must contain the following parameter: 'scope'.",
        ...(params.state !== null && { state: params.state }),
      })

    const microsoft = context.microsoft()
    const accounts = microsoft.users.all().filter((user) => tenantAllows(tenant, user))

    return c.html(
      renderChooser({
        title: "Pick an account",
        subtitle: `to continue to ${microsoft.clients.findOneBy("client_id", params.client_id)?.name ?? "the app"}`,
        action: `/${encodeURIComponent(tenant)}/login`,
        requestId: parkRequest(microsoft, params),
        accounts: accounts.map((user) => ({ id: user.oid, name: user.name, email: user.email })),
      }),
    )
  })

  app.post("/:tenant/login", (c) => {
    const microsoft = context.microsoft()
    const userWith = (oid: string) => microsoft.users.findOneBy("oid", oid)

    return completeSignIn(c, {
      tables: microsoft,
      clock,
      accept: (oid, params) => {
        const user = userWith(oid)

        return user && tenantAllows(params.tenant, user) ? user.oid : undefined
      },
      extras: (_params, oid) => {
        const user = userWith(oid)

        return { ...(user && { client_info: clientInfo(user) }), session_state: randomUUID() }
      },
      denied: {
        error: "access_denied",
        error_description: "AADSTS65004: User declined to consent to access the app.",
      },
    })
  })

  app.get("/:tenant/oauth2/v2.0/logout", (c) => {
    const back = c.req.query("post_logout_redirect_uri")

    return back
      ? c.redirect(back, 302)
      : c.html(renderProblem("Signed out", "You have signed out of your account."))
  })
}
