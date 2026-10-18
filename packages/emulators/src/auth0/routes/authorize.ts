import type { Context } from "../../http.ts"
import type { Auth0RouteContext } from "../context.ts"
import type { Auth0AuthorizeParams, Auth0ClientRecord, Auth0TenantRecord } from "../entities.ts"
import { backToApp, finishLogin, sessionCookie } from "../flow.ts"
import { opaque, requireTenant, urlAllowed } from "../helpers.ts"
import { renderError } from "../pages.ts"
import type { Auth0Store } from "../store.ts"

/** How the code comes back: in the query unless the app asked for the fragment or a form post. */
function responseMode(mode: string | undefined): Auth0AuthorizeParams["response_mode"] {
  return mode === "fragment" || mode === "form_post" ? mode : "query"
}

/** The PKCE method: as given, or `plain` when a challenge came without one. */
function challengeMethod(
  method: string | undefined,
  challenge: string | null,
): Auth0AuthorizeParams["code_challenge_method"] {
  if (method === "S256" || method === "plain") return method

  return challenge ? "plain" : null
}

/** The authorization request's parameters, as kept while the user logs in. */
function paramsOf(c: Context): Auth0AuthorizeParams {
  const given = (name: string) => c.req.query(name) ?? null
  const challenge = given("code_challenge")

  return {
    client_id: given("client_id") ?? "",
    redirect_uri: given("redirect_uri") ?? "",
    response_type: given("response_type") ?? "",
    response_mode: responseMode(c.req.query("response_mode")),
    scope: given("scope") ?? "openid",
    state: given("state"),
    nonce: given("nonce"),
    audience: given("audience"),
    organization: given("organization"),
    code_challenge: challenge,
    code_challenge_method: challengeMethod(c.req.query("code_challenge_method"), challenge),
  }
}

/** The error Auth0 sends back to a valid callback when a request can't go on. */
function refuseToApp(c: Context, params: Auth0AuthorizeParams, error: string, description: string) {
  return backToApp(c, params, { error, error_description: description })
}

/** A problem with the request the app can be told about, once its callback URL checked out. */
function requestProblem(
  auth0: Auth0Store,
  tenant: Auth0TenantRecord,
  params: Auth0AuthorizeParams,
): readonly [string, string] | undefined {
  if (params.response_type !== "code")
    return ["unsupported_response_type", `Unsupported response type: ${params.response_type}`]
  if (
    params.audience !== null &&
    !auth0.apis.findBy("identifier", params.audience).some((api) => api.tenant === tenant.domain)
  )
    return ["access_denied", `Service not found: ${params.audience}`]
  if (
    params.organization !== null &&
    !auth0.organizations
      .all()
      .some(
        (org) =>
          org.tenant === tenant.domain &&
          (org.orgId === params.organization || org.name === params.organization),
      )
  )
    return [
      "invalid_request",
      `parameter organization is invalid: no organization found by that id or name`,
    ]

  return undefined
}

/** The organization's id, when the request named it by name. */
function organizationId(auth0: Auth0Store, tenant: string, given: string | null): string | null {
  if (given === null) return null

  return (
    auth0.organizations
      .all()
      .find((org) => org.tenant === tenant && (org.orgId === given || org.name === given))?.orgId ??
    given
  )
}

/** `prompt=none`: a live session signs in without a page; without one the app hears `login_required`. */
function silentLogin(
  c: Context,
  context: Auth0RouteContext,
  tenant: Auth0TenantRecord,
  params: Auth0AuthorizeParams,
) {
  const auth0 = context.auth0()
  const sid = sessionCookie(c)
  const session = sid === undefined ? undefined : auth0.sessions.findOneBy("sid", sid)
  const user =
    session && !session.ended && session.tenant === tenant.domain
      ? auth0.users.findOneBy("user_id", session.user_id)
      : undefined

  if (!session || !user || user.blocked)
    return refuseToApp(c, params, "login_required", "Login required")

  const txn = auth0.transactions.insert({
    txn: opaque(18),
    tenant: tenant.domain,
    params,
    pendingUser: null,
    method: "silent",
  })

  return finishLogin(c, {
    auth0,
    clock: context.clock,
    tenant,
    txn,
    user,
    mfa: false,
    sid: session.sid,
  })
}

/** The page Auth0 stops on when the client or its callback URL is wrong. */
function clientProblem(
  client: Auth0ClientRecord | undefined,
  params: Auth0AuthorizeParams,
): readonly [string, string] | undefined {
  if (!client) return ["invalid_request", `Unknown client: ${params.client_id}`]
  if (!urlAllowed(params.redirect_uri, client.callbacks))
    return [
      "Callback URL mismatch.",
      `The provided redirect_uri is not in the list of allowed callback URLs: ${params.redirect_uri}`,
    ]

  return undefined
}

/** `/authorize`: checks the request, then starts Universal Login (or a silent login). */
export function authorizeRoutes(context: Auth0RouteContext): void {
  context.app.get("/authorize", (c) => {
    const auth0 = context.auth0()
    const tenant = requireTenant(c, auth0)
    const given = paramsOf(c)
    const client = auth0.clients
      .findBy("client_id", given.client_id)
      .find((found) => found.tenant === tenant.domain)
    const stop = clientProblem(client, given)

    if (stop) return c.html(renderError(stop[0], stop[1]), 400)

    const problem = requestProblem(auth0, tenant, given)

    if (problem) return refuseToApp(c, given, problem[0], problem[1])

    const params = {
      ...given,
      organization: organizationId(auth0, tenant.domain, given.organization),
    }

    if (c.req.query("prompt") === "none") return silentLogin(c, context, tenant, params)

    const txn = auth0.transactions.insert({
      txn: opaque(18),
      tenant: tenant.domain,
      params,
      pendingUser: null,
      method: "password",
    })
    const screen = c.req.query("screen_hint") === "signup" ? "signup" : "login"

    return c.redirect(`/u/${screen}?state=${encodeURIComponent(txn.txn)}`, 302)
  })
}
