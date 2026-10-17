import { HttpError } from "../errors.ts"
import type { Context, ErrorHandler } from "../http.ts"
import { isRecord } from "../json.ts"
import { bearerToken, liveToken } from "../oauth/tokens.ts"
import type { GoogleRouteContext } from "./context.ts"
import type { GoogleUser } from "./entities.ts"
import { googleError } from "./helpers.ts"

export { isRecord }

/** The canonical status Google's JSON errors name for each HTTP status. */
const STATUS_NAMES: Readonly<Record<number, string>> = {
  400: "INVALID_ARGUMENT",
  401: "UNAUTHENTICATED",
  403: "PERMISSION_DENIED",
  404: "NOT_FOUND",
  409: "ALREADY_EXISTS",
  410: "FAILED_PRECONDITION",
  412: "FAILED_PRECONDITION",
  429: "RESOURCE_EXHAUSTED",
  500: "INTERNAL",
  503: "UNAVAILABLE",
}

/** Google's API error body: `{ error: { code, message, errors: [{ domain, reason, message }], status } }`. */
export function apiErrorBody(code: number, reason: string, message: string) {
  return {
    error: {
      code,
      message,
      errors: [{ message, domain: "global", reason }],
      status: STATUS_NAMES[code] ?? "UNKNOWN",
    },
  }
}

/**
 * An error a Gmail, Calendar or Drive handler throws to answer in Google's API error format: an
 * HTTP error that also names Google's `reason`.
 */
export class GoogleApiError extends HttpError {
  readonly reason: string

  constructor(status: number, reason: string, message: string) {
    super(status, message)
    this.reason = reason
  }
}

/** A 404 for a resource the caller cannot see or that does not exist. */
export function notFound(what = "Requested entity was not found."): GoogleApiError {
  return new GoogleApiError(404, "notFound", what)
}

/** A 400 for a request Google would refuse as malformed. */
export function badRequest(message: string, reason = "badRequest"): GoogleApiError {
  return new GoogleApiError(400, reason, message)
}

const API_PATH = /^\/(gmail|calendar|drive|upload)\//

/**
 * The emulator's error hook: API paths answer in the API error format, sign-in paths in the OAuth
 * `{ error, error_description }` format.
 */
export function googleErrors(): ErrorHandler {
  return (error, c) => {
    if (error instanceof GoogleApiError)
      return c.json(apiErrorBody(error.status, error.reason, error.message), error.status)

    const message = error instanceof Error ? error.message : "Internal error"

    if (API_PATH.test(c.req.path))
      return c.json(apiErrorBody(500, "backendError", "Backend Error"), 500)

    return googleError(c, 500, "internal_failure", message)
  }
}

/** Who is calling an API, as their access token says. */
export interface Caller {
  readonly user: GoogleUser
  readonly clientId: string
  readonly scope: readonly string[]
}

const INVALID_CREDENTIALS =
  "Request had invalid authentication credentials. Expected OAuth 2 access token, login cookie or other valid authentication credential."

/**
 * The caller behind the request's bearer token, if it was granted one of `accepted`. A missing,
 * expired or revoked token is a 401; a token without a fitting scope is a 403.
 */
export function requireAccess(
  c: Context,
  context: GoogleRouteContext,
  accepted: readonly string[],
): Caller {
  const google = context.google()
  const token = liveToken(google.tokens, bearerToken(c) ?? "", "access", context.clock)
  const user = token && google.users.findOneBy("uid", token.user)

  if (!token || !user) {
    c.header("www-authenticate", 'Bearer realm="https://accounts.google.com/"')

    throw new GoogleApiError(401, "authError", INVALID_CREDENTIALS)
  }

  const scope = token.scope.split(/\s+/).filter(Boolean)

  if (!accepted.some((wanted) => scope.includes(wanted)))
    throw new GoogleApiError(
      403,
      "insufficientPermissions",
      "Request had insufficient authentication scopes.",
    )

  return { user, clientId: token.clientId, scope }
}

/** JSON text as a record; empty, invalid or non-object JSON is a 400. */
export function recordOf(text: string): Record<string, unknown> {
  if (text.trim() === "") return {}

  let parsed: unknown

  try {
    parsed = JSON.parse(text)
  } catch {
    throw badRequest("Invalid JSON payload received.", "parseError")
  }

  return isRecord(parsed) ? parsed : {}
}

/** A JSON request body as a record; an empty or non-object body is `{}`. */
export async function jsonBody(c: Context): Promise<Record<string, unknown>> {
  return recordOf(await c.req.text())
}

/** Every value of a repeated query parameter. */
export function queryAll(c: Context, name: string): string[] {
  return new URL(c.req.url).searchParams.getAll(name)
}

/** A whole-number query parameter within `[1, max]`, or `fallback`. */
export function pageSize(c: Context, name: string, fallback: number, max: number): number {
  const value = Number(c.req.query(name))

  return Number.isInteger(value) && value > 0 ? Math.min(value, max) : fallback
}

/** One page of `items` starting at the offset in `token`, and the token for the next page. */
export function pageOf<T>(
  items: readonly T[],
  token: string | undefined,
  size: number,
): { readonly items: T[]; readonly next: string | undefined } {
  const start = token ? Number(Buffer.from(token, "base64url").toString("utf8")) || 0 : 0
  const end = start + size

  return {
    items: items.slice(start, end),
    next: end < items.length ? Buffer.from(String(end)).toString("base64url") : undefined,
  }
}
