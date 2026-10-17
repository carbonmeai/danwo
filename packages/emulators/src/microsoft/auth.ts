import type { Context } from "../http.ts"
import { bearerToken, liveToken } from "../oauth/tokens.ts"
import type { Clock } from "../store.ts"
import type { MicrosoftUser } from "./entities.ts"
import { graphError } from "./helpers.ts"
import type { MicrosoftStore } from "./store.ts"

/** Who is calling Graph, for which app, and with which delegated scopes. */
export interface GraphCaller {
  readonly user: MicrosoftUser
  readonly clientId: string
  readonly scope: string
}

/** The user behind a Graph request's bearer token, or Graph's 401 `InvalidAuthenticationToken`. */
export function graphCaller(
  c: Context,
  microsoft: MicrosoftStore,
  clock: Clock,
): GraphCaller | Response {
  const presented = bearerToken(c)
  const token =
    presented === undefined ? undefined : liveToken(microsoft.tokens, presented, "access", clock)
  const user = token && microsoft.users.findOneBy("oid", token.user)

  if (token && user) return { user, clientId: token.clientId, scope: token.scope }

  return graphError(c, clock, {
    status: 401,
    code: "InvalidAuthenticationToken",
    message: presented
      ? "Lifetime validation failed, the token is expired."
      : "Access token is empty.",
  })
}
