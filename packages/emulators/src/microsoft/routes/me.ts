import { graphCaller } from "../auth.ts"
import type { MicrosoftRouteContext } from "../context.ts"
import { graphUser, userInfo } from "../formatters.ts"
import { revokeSessions } from "../sessions.ts"

/** Graph's `/me`, its OpenID userinfo, and signing the user out of every app. */
export function meRoutes({ app, microsoft, clock }: MicrosoftRouteContext): void {
  app.get("/v1.0/me", (c) => {
    const caller = graphCaller(c, microsoft(), clock)

    return caller instanceof Response ? caller : c.json(graphUser(caller.user))
  })

  app.get("/oidc/userinfo", (c) => {
    const caller = graphCaller(c, microsoft(), clock)

    return caller instanceof Response ? caller : c.json(userInfo(caller.user, caller.clientId))
  })

  /** Revokes every refresh and access token the user holds, as an admin or the user can. */
  app.post("/v1.0/me/revokeSignInSessions", (c) => {
    const caller = graphCaller(c, microsoft(), clock)

    if (caller instanceof Response) return caller
    revokeSessions(microsoft(), caller.user.oid)

    return c.json({
      "@odata.context": "https://graph.microsoft.com/v1.0/$metadata#Edm.Boolean",
      value: true,
    })
  })
}
