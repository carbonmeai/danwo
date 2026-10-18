import type { Emulator } from "../define.ts"
import { defineEmulator } from "../define.ts"
import type { Context, ErrorHandler } from "../http.ts"
import { createSigningKey } from "../oauth/jwt.ts"
import type { Store } from "../store.ts"
import type { Auth0RouteContext, Upstream } from "./context.ts"
import { ManagementError, managementErrorBody, oauthError, UnknownTenant } from "./helpers.ts"
import { managementMiddleware } from "./management.ts"
import { renderError } from "./pages.ts"
import { authorizeRoutes } from "./routes/authorize.ts"
import { discoveryRoutes } from "./routes/discovery.ts"
import { jobRoutes } from "./routes/jobs.ts"
import { universalLoginRoutes } from "./routes/login.ts"
import { organizationManagementRoutes } from "./routes/organizations.ts"
import { roleManagementRoutes } from "./routes/roles.ts"
import { sessionRoutes } from "./routes/session.ts"
import { socialRoutes } from "./routes/social.ts"
import { tokenRoutes } from "./routes/token.ts"
import { userRoutes } from "./routes/users.ts"
import { UnsupportedQuery } from "./search.ts"
import { auth0Store } from "./store.ts"

export { auth0OutboundFaults } from "./faults.ts"
export { AUTH0_HOSTS, isAuth0Host } from "./helpers.ts"
export { otpAt as auth0OtpAt } from "./otp.ts"
export {
  type Auth0LoginView,
  type Auth0Tenant,
  auth0Tenant,
  type Auth0UserView,
} from "./inspect.ts"
export {
  type Auth0SeedApi,
  type Auth0SeedClient,
  type Auth0SeedConfig,
  type Auth0SeedRole,
  type Auth0SeedTenant,
  type Auth0SeedUser,
  MANAGEMENT_SCOPES,
  seedAuth0,
} from "./seed.ts"

/** Where each emulator's social logins exchange their codes, once a runner connects one. */
const UPSTREAMS = new WeakMap<Store, Upstream>()

/**
 * Connects an Auth0 emulator to the upstream social providers: a social login's code exchange and
 * profile lookup go through `upstream`, typically the Google, GitHub or Microsoft emulator.
 */
export function connectAuth0Upstream(emulator: Pick<Emulator, "store">, upstream: Upstream): void {
  UPSTREAMS.set(emulator.store, upstream)
}

function managementFailure(c: Context, error: unknown): Response {
  if (error instanceof ManagementError)
    return c.json(managementErrorBody(error.status, error.message, error.errorCode), error.status)
  if (error instanceof UnsupportedQuery)
    return c.json(managementErrorBody(400, error.message, "invalid_query_string"), 400)
  if (error instanceof SyntaxError)
    return c.json(
      managementErrorBody(400, "Invalid request payload JSON format", "invalid_body"),
      400,
    )

  return c.json(managementErrorBody(500, "Internal Server Error"), 500)
}

/** Management API paths answer in its error shape; the rest as the authentication API and pages do. */
function auth0Errors(): ErrorHandler {
  return (error, c) => {
    if (c.req.path.startsWith("/api/v2/")) return managementFailure(c, error)
    if (error instanceof UnknownTenant)
      return c.html(renderError("Unknown tenant", error.message), 404)
    if (c.req.path.startsWith("/oauth/"))
      return oauthError(
        c,
        500,
        "server_error",
        error instanceof Error ? error.message : "Internal Server Error",
      )

    return c.html(
      renderError("server_error", error instanceof Error ? error.message : "Internal Server Error"),
      500,
    )
  }
}

function routes(context: Auth0RouteContext): void {
  for (const register of [
    discoveryRoutes,
    authorizeRoutes,
    universalLoginRoutes,
    socialRoutes,
    tokenRoutes,
    sessionRoutes,
    userRoutes,
    roleManagementRoutes,
    organizationManagementRoutes,
    jobRoutes,
  ])
    register(context)
}

/**
 * Auth0 on its tenant domains (`<tenant>.auth0.com` and the regional ones, plus custom domains):
 * Universal Login with email and password, signup, a one-time-code second factor and social
 * buttons; the authorization code flow with PKCE, refresh tokens with rotation, client
 * credentials and the password grant; OIDC discovery, keys and `/userinfo`; logout; and the
 * Management API v2's users, roles, permissions, organizations, blocks and verification emails.
 */
export const auth0 = defineEmulator({
  name: "auth0",
  setup({ app, store, clock }) {
    const context: Auth0RouteContext = {
      app,
      clock,
      auth0: () => auth0Store(store),
      key: createSigningKey(),
      upstream: () => UPSTREAMS.get(store),
    }

    app.onError(auth0Errors())
    app.use(managementMiddleware(context))
    routes(context)
  },
})
