import type { Context, Middleware } from "../http.ts"
import { bearerToken } from "../oauth/tokens.ts"
import type { Auth0RouteContext } from "./context.ts"
import type { Auth0TenantRecord, Auth0UserRecord } from "./entities.ts"
import { ManagementError, managementAudience, requireTenant, scopesOf } from "./helpers.ts"
import { hasAudience, verifiedClaims } from "./verify.ts"

/** Calls a Management API token may make per window, before Auth0 answers 429. */
const RATE_LIMIT = 50
const RATE_WINDOW_MS = 1000

/** What a Management API handler gets: the request's tenant and what its token allows. */
export interface ManagementCall {
  readonly tenant: Auth0TenantRecord
  readonly scopes: readonly string[]
}

const CALLS = new WeakMap<Context, ManagementCall>()

/** The tenant and token scopes of a Management API request the middleware let through. */
function managementCall(c: Context): ManagementCall {
  const call = CALLS.get(c)

  if (!call) throw new ManagementError(401, "Missing authentication")

  return call
}

/** Refuses a call whose token lacks `scope`, the way Auth0 words it. */
export function requireScope(c: Context, scope: string): ManagementCall {
  const call = managementCall(c)

  if (!call.scopes.includes(scope))
    throw new ManagementError(
      403,
      `Insufficient scope, expected any of: ${scope}`,
      "insufficient_scope",
    )

  return call
}

/** The rate-limit headers Auth0 puts on every Management API answer, counted per token. */
function rateLimiter(context: Auth0RouteContext) {
  const windows = new Map<string, { start: number; used: number }>()

  return (token: string) => {
    const now = context.clock().getTime()
    const current = windows.get(token)
    const window =
      current && now - current.start < RATE_WINDOW_MS ? current : { start: now, used: 0 }

    window.used += 1
    windows.set(token, window)

    return {
      exceeded: window.used > RATE_LIMIT,
      headers: {
        "x-ratelimit-limit": String(RATE_LIMIT),
        "x-ratelimit-remaining": String(Math.max(0, RATE_LIMIT - window.used)),
        "x-ratelimit-reset": String(Math.ceil((window.start + RATE_WINDOW_MS) / 1000)),
      },
    }
  }
}

/** The claims of a request's Management API token for `tenant`, or the 401 Auth0 answers. */
function managementClaims(
  context: Auth0RouteContext,
  token: string | undefined,
  tenant: Auth0TenantRecord,
) {
  if (!token) throw new ManagementError(401, "Missing authentication")

  const claims = verifiedClaims(context.key, token, context.clock)

  if (!claims) throw new ManagementError(401, "Invalid token")
  if (!hasAudience(claims, managementAudience(tenant.domain)))
    throw new ManagementError(
      401,
      "Bad audience: the token is not for this tenant's Management API",
    )

  return claims
}

/** Authenticates `/api/v2/` calls with a Management API token and adds the rate-limit headers. */
export function managementMiddleware(context: Auth0RouteContext): Middleware {
  const limit = rateLimiter(context)

  return async (c, next) => {
    if (!c.req.path.startsWith("/api/v2/")) return next()

    const tenant = requireTenant(c, context.auth0())
    const token = bearerToken(c)
    const claims = managementClaims(context, token, tenant)
    const rate = limit(token ?? "")

    for (const [name, value] of Object.entries(rate.headers)) c.header(name, value)
    if (rate.exceeded)
      throw new ManagementError(429, "Global limit has been reached", "too_many_requests")

    CALLS.set(c, { tenant, scopes: scopesOf(typeof claims.scope === "string" ? claims.scope : "") })

    return next()
  }
}

/** A page of a list, in the shape Auth0 answers with or without `include_totals`. */
export function paged(c: Context, key: string, items: readonly unknown[]): Response {
  const page = Math.max(0, Number(c.req.query("page") ?? 0))
  const perPage = Math.min(100, Math.max(1, Number(c.req.query("per_page") ?? 50)))
  const slice = items.slice(page * perPage, page * perPage + perPage)

  if (c.req.query("include_totals") !== "true") return c.json(slice)

  return c.json({
    start: page * perPage,
    limit: perPage,
    length: slice.length,
    total: items.length,
    [key]: slice,
  })
}

/** The strings in a request body's list field, such as `roles` or `members`. */
export const stringsIn = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []

/** The user `id` names on the call's tenant, or a 404. */
export function managedUser(
  context: Auth0RouteContext,
  tenant: string,
  id: string,
): Auth0UserRecord {
  const user = context
    .auth0()
    .users.findBy("user_id", id)
    .find((found) => found.tenant === tenant)

  if (!user) throw new ManagementError(404, "The user does not exist.", "inexistent_user")

  return user
}
