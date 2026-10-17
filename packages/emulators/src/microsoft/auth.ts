import { randomUUID } from "node:crypto"

import type { Context } from "../http.ts"
import { bearerToken, liveToken } from "../oauth/tokens.ts"
import type { Clock } from "../store.ts"
import type { MicrosoftUser } from "./entities.ts"
import type { MicrosoftStore } from "./store.ts"

/** The user behind a Graph request's bearer token, or Graph's 401 `InvalidAuthenticationToken`. */
export function graphCaller(
  c: Context,
  microsoft: MicrosoftStore,
  clock: Clock,
): { readonly user: MicrosoftUser; readonly clientId: string } | Response {
  const presented = bearerToken(c)
  const token =
    presented === undefined ? undefined : liveToken(microsoft.tokens, presented, "access", clock)
  const user = token && microsoft.users.findOneBy("oid", token.user)

  if (token && user) return { user, clientId: token.clientId }

  return c.json(
    {
      error: {
        code: "InvalidAuthenticationToken",
        message: presented
          ? "Lifetime validation failed, the token is expired."
          : "Access token is empty.",
        innerError: {
          date: clock().toISOString(),
          "request-id": randomUUID(),
          "client-request-id": randomUUID(),
        },
      },
    },
    401,
  )
}
