import { googleBearer } from "../auth.ts"
import type { GoogleRouteContext } from "../context.ts"
import { userInfo } from "../formatters.ts"

/** Userinfo at each URL Google serves it from; the fields follow the token's scope. */
export function userinfoRoutes({ app, google, clock }: GoogleRouteContext): void {
  for (const path of ["/v1/userinfo", "/oauth2/v2/userinfo", "/oauth2/v3/userinfo"])
    app.get(path, (c) => {
      const caller = googleBearer(c, google(), clock)

      return caller instanceof Response ? caller : c.json(userInfo(caller.user, caller.scope))
    })
}
