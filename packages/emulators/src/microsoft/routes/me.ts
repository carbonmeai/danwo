import { graphCaller } from "../auth.ts"
import type { MicrosoftRouteContext } from "../context.ts"
import { graphUser, userInfo } from "../formatters.ts"

/** Graph's `/me` and its OpenID userinfo, for the signed-in user. */
export function meRoutes({ app, microsoft, clock }: MicrosoftRouteContext): void {
  app.get("/v1.0/me", (c) => {
    const caller = graphCaller(c, microsoft(), clock)

    return caller instanceof Response ? caller : c.json(graphUser(caller.user))
  })

  app.get("/oidc/userinfo", (c) => {
    const caller = graphCaller(c, microsoft(), clock)

    return caller instanceof Response ? caller : c.json(userInfo(caller.user, caller.clientId))
  })
}
