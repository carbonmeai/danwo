import { defineEmulator, type EmulatorContext } from "../define.ts"
import { HttpError } from "../errors.ts"
import { App, type ErrorHandler, type Middleware } from "../http.ts"
import { createSigningKey } from "../oauth/jwt.ts"
import { backendAuth } from "./backend-auth.ts"
import { type ClerkContext, instanceOf, registerContext } from "./context.ts"
import { BAPI_HOST, ClerkFailure, clerkErrorBody } from "./helpers.ts"
import { accountsRoutes } from "./routes/accounts.ts"
import { attemptRoutes } from "./routes/attempts.ts"
import { clientApiRoutes } from "./routes/client.ts"
import { frontendCors, frontendRoutes, methodOverride } from "./routes/frontend.ts"
import { instanceRoutes } from "./routes/instance.ts"
import { organizationRoutes } from "./routes/organizations.ts"
import { sessionRoutes } from "./routes/sessions.ts"
import { userRoutes } from "./routes/users.ts"
import { clerkScripts } from "./scripts.ts"
import { instanceFrom } from "./seed.ts"
import { clerkStore, INSTANCE } from "./store.ts"

export { clerkOutboundFaults } from "./faults.ts"
export { CLERK_HOSTS, cookieSuffix, publishableKeyFor } from "./helpers.ts"
export { type ClerkInstanceView, clerkInstance } from "./inspect.ts"
export {
  type ClerkSeedConfig,
  type ClerkSeedOrganization,
  type ClerkSeedTemplate,
  type ClerkSeedUser,
  seedClerk,
} from "./seed.ts"
export type { ClerkInstance, ClerkMessage } from "./store.ts"
export type { ClerkUser } from "./entities.ts"

/** Answers errors in Clerk's format: a list of `{message, long_message, code}` and a trace id. */
const clerkErrors: ErrorHandler = (error, c) => {
  if (error instanceof ClerkFailure) return c.json(clerkErrorBody([error.entry]), error.status)

  const status = error instanceof HttpError ? error.status : 500
  const message = error instanceof Error ? error.message : "Internal server error"

  return c.json(
    clerkErrorBody([
      {
        message,
        long_message: message,
        code: status === 404 ? "resource_not_found" : "internal_clerk_error",
      },
    ]),
    status,
  )
}

/** A sub-app with Clerk's error answers. */
function clerkApp(): App {
  const app = new App()

  app.onError(clerkErrors)

  return app
}

/** Sends each request to the app for its host: the Backend API, the Frontend API or the portal. */
function byHost(
  context: ClerkContext,
  apps: { backend: App; frontend: App; accounts: App },
): Middleware {
  return (c, next) => {
    const host = new URL(c.req.url).hostname
    const instance = instanceOf(context)

    if (host === BAPI_HOST) return apps.backend.fetch(c.req.raw)
    if (host === instance.frontendApi) return apps.frontend.fetch(c.req.raw)
    if (host === instance.accountsHost) return apps.accounts.fetch(c.req.raw)

    return next()
  }
}

function contextFor(emulator: EmulatorContext): ClerkContext {
  return registerContext({
    clerk: clerkStore(emulator.store),
    store: emulator.store,
    outbox: emulator.outbox,
    clock: emulator.clock,
    wallClock: emulator.wallClock,
    key: createSigningKey(),
  })
}

/**
 * Clerk on its real hosts for a development instance: the Backend API on `api.clerk.com` (users,
 * sessions and their tokens, organizations, memberships and invitations, sign-in tokens, JWT
 * templates, JWKS and handshake payloads); the Frontend API on `<slug>.clerk.accounts.dev` (the
 * handshake an app's middleware redirects through, and the public keys); and the Account Portal
 * on `<slug>.accounts.dev` (sign-in with a password or emailed code, sign-up, sign-in links).
 * Session tokens are RS256 JWTs with Clerk's claims, signed by a key per emulator.
 */
export const clerk = defineEmulator({
  name: "clerk",
  setup(emulator) {
    const context = contextFor(emulator)
    const apps = { backend: clerkApp(), frontend: clerkApp(), accounts: clerkApp() }

    emulator.app.use(byHost(context, apps))
    apps.backend.use(backendAuth(emulator.store))
    userRoutes(apps.backend, context)
    sessionRoutes(apps.backend, context)
    organizationRoutes(apps.backend, context)
    instanceRoutes(apps.backend, context)
    apps.frontend.use(frontendCors())
    apps.frontend.use(methodOverride(apps.frontend))
    apps.frontend.use(clerkScripts())
    frontendRoutes(apps.frontend, context)
    clientApiRoutes(apps.frontend, context)
    attemptRoutes(apps.frontend, context)
    accountsRoutes(apps.accounts, context)
  },
  seed: ({ store }) => {
    store.setData(INSTANCE, instanceFrom())
  },
})
