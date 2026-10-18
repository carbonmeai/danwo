import type { MicrosoftRouteContext } from "../context.ts"
import { discoveryDocument } from "../formatters.ts"
import { MICROSOFT_LOGIN } from "../helpers.ts"

/** The hosts MSAL may know the login endpoint by; they all mean the same cloud. */
const LOGIN_ALIASES = [
  "login.microsoftonline.com",
  "login.windows.net",
  "login.microsoft.com",
  "sts.windows.net",
]

/** OpenID configuration and keys per tenant path, and the instance discovery MSAL asks for first. */
export function discoveryRoutes({ app, key }: MicrosoftRouteContext): void {
  app.get("/:tenant/v2.0/.well-known/openid-configuration", (c) =>
    c.json(discoveryDocument(c.req.param("tenant"))),
  )

  /** Microsoft's keys carry no `alg`, and name the cloud and issuer pattern they sign for. */
  app.get("/:tenant/discovery/v2.0/keys", (c) => {
    const { kty, use, kid, n, e } = key.jwk

    return c.json({
      keys: [
        {
          kty,
          use,
          kid,
          n,
          e,
          cloud_instance_name: "microsoftonline.com",
          issuer: `${MICROSOFT_LOGIN}/{tenantid}/v2.0`,
        },
      ],
    })
  })

  app.get("/:tenant/discovery/instance", (c) => {
    const endpoint = c.req.query("authorization_endpoint")
    const tenant = endpoint ? (new URL(endpoint).pathname.split("/")[1] ?? "common") : "common"

    return c.json({
      tenant_discovery_endpoint: `${MICROSOFT_LOGIN}/${tenant}/v2.0/.well-known/openid-configuration`,
      "api-version": "1.1",
      metadata: [
        {
          preferred_network: "login.microsoftonline.com",
          preferred_cache: "login.windows.net",
          aliases: LOGIN_ALIASES,
        },
      ],
    })
  })
}
