import type { Context } from "../http.ts"
import { bearerToken, liveToken } from "../oauth/tokens.ts"
import type { Clock } from "../store.ts"
import type { GoogleUser } from "./entities.ts"
import type { GoogleStore } from "./store.ts"

/**
 * The user behind a request's bearer access token, or Google's 401: a `WWW-Authenticate`
 * challenge and `invalid_request`, as userinfo answers a missing, revoked or expired token.
 */
export function googleBearer(
  c: Context,
  google: GoogleStore,
  clock: Clock,
): { readonly user: GoogleUser; readonly scope: string } | Response {
  const token = liveToken(google.tokens, bearerToken(c) ?? "", "access", clock)
  const user = token && google.users.findOneBy("uid", token.user)

  if (token && user) return { user, scope: token.scope }

  c.header("www-authenticate", 'Bearer realm="https://accounts.google.com/", error="invalid_token"')

  return c.json({ error: "invalid_request", error_description: "Invalid Credentials" }, 401)
}
