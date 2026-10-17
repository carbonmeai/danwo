import type { GoogleRouteContext } from "../context.ts"
import { discoveryDocument } from "../formatters.ts"

/** Discovery, and the signing key as a JWKS (v3) and as PEM by key id (v1, which google-auth-library reads). */
export function discoveryRoutes({ app, key }: GoogleRouteContext): void {
  app.get("/.well-known/openid-configuration", (c) => c.json(discoveryDocument()))
  app.get("/oauth2/v3/certs", (c) => c.json({ keys: [key.jwk] }))
  app.get("/oauth2/v1/certs", (c) => c.json({ [key.kid]: key.pem }))
}
