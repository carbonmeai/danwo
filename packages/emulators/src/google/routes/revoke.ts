import { formFields, revokeToken } from "../../oauth/tokens.ts"
import type { GoogleRouteContext } from "../context.ts"
import { googleError } from "../helpers.ts"

/** Revocation: a refresh token takes the access tokens made from it along. */
export function revokeRoutes({ app, google }: GoogleRouteContext): void {
  for (const path of ["/revoke", "/o/oauth2/revoke"])
    app.post(path, async (c) => {
      const token =
        (await formFields(c)).token ?? new URL(c.req.url).searchParams.get("token") ?? ""

      return revokeToken(google().tokens, token)
        ? c.body(null, 200)
        : googleError(c, 400, "invalid_token", "Token expired or revoked")
    })
}
