/**
 * Who a Nylas call acts as: the application, with its API key (`nyk_…`), or one grant, with an
 * access token the hosted auth flow handed out. Grant-scoped paths accept either; `me` stands for
 * the token's own grant.
 */
import type { Context } from "../http.ts"
import type { NylasGrant } from "./entities.ts"
import { NylasError, type NylasRouteContext, notFound, seconds } from "./helpers.ts"

export type NylasCaller =
  | { readonly kind: "application" }
  | { readonly kind: "grant"; readonly grantId: string }

/** A credential Nylas cannot verify, as the live API words it. */
const unauthorized = () =>
  new NylasError(401, "api.invalid_request_error", "Could not verify access credential")

/** No credential at all: answered before Nylas assigns a request id. */
const missing = () =>
  new NylasError(401, "invalid_request_error", "Could not verify access credential.", true)

/** The bearer token a request carries, if any. */
function bearerOf(c: Context): string | undefined {
  const header = c.req.header("authorization") ?? ""

  return header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : undefined
}

/** Who `c` is from: an accepted API key, or a live access token of a grant. */
export function callerOf(context: NylasRouteContext, c: Context): NylasCaller {
  const token = bearerOf(c)

  if (token === undefined || token === "") throw missing()

  const keys = context.objects.apiKeys()

  if (keys.includes(token) || (keys.length === 0 && token.startsWith("nyk_")))
    return { kind: "application" }

  const issued = context.objects.tokens.get(token)

  if (issued?.kind === "access" && issued.expires_at > seconds(context.clock))
    return { kind: "grant", grantId: issued.grant_id }

  throw unauthorized()
}

/** The application's own calls (webhooks, applications): an API key only. */
export function requireApplication(context: NylasRouteContext, c: Context): void {
  if (callerOf(context, c).kind !== "application") throw unauthorized()
}

/** The grant a `/v3/grants/:grant/...` path names, checked against the caller. */
export function grantOf(context: NylasRouteContext, c: Context): NylasGrant {
  const caller = callerOf(context, c)
  const named = c.req.param("grant")
  const id = named === "me" && caller.kind === "grant" ? caller.grantId : named

  if (caller.kind === "grant" && caller.grantId !== id) throw unauthorized()

  const grant = context.objects.grants.get(id)

  if (grant === undefined) throw notFound(`grant ${id}`)
  if (grant.grant_status !== "valid")
    throw new NylasError(401, "token.unauthorized", "The grant is invalid; re-authenticate.")

  return grant
}
