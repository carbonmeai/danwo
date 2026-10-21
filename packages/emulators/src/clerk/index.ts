import { browserCors } from "../cors.ts"
import { defineEmulator, type EmulatorContext } from "../define.ts"
import { HttpError } from "../errors.ts"
import { App, type Context, type ErrorHandler, type Middleware } from "../http.ts"
import { createSigningKey } from "../oauth/jwt.ts"
import { SVIX_DELIVERY } from "../svix.ts"
import { signedOnWallClock } from "../webhooks.ts"
import { backendAuth } from "./backend-auth.ts"
import { browserRequest, currentClient } from "./browser-request.ts"
import { type ClerkContext, instanceOf, registerContext } from "./context.ts"
import { browserClient } from "./frontend-json.ts"
import { BAPI_HOST, ClerkFailure, clerkErrorBody, IMAGE_HOST } from "./helpers.ts"
import { clerkImage } from "./images.ts"
import { accountsRoutes } from "./routes/accounts.ts"
import { attemptRoutes } from "./routes/attempts.ts"
import { clientApiRoutes } from "./routes/client.ts"
import { frontendRoutes, methodOverride } from "./routes/frontend.ts"
import { instanceRoutes } from "./routes/instance.ts"
import { meApiRoutes } from "./routes/me.ts"
import { oauthRoutes } from "./routes/oauth.ts"
import { organizationRoutes } from "./routes/organizations.ts"
import { sessionRoutes } from "./routes/sessions.ts"
import { ticketRoutes } from "./routes/tickets.ts"
import { userRoutes } from "./routes/users.ts"
import { clerkScripts } from "./scripts.ts"
import { instanceFrom } from "./seed.ts"
import { clerkStore, INSTANCE } from "./store.ts"
import { clerkCustomHeaders, clerkEndpoints, ClerkEvents, clerkWebhookHeaders } from "./webhooks.ts"

export { clerkOutboundFaults } from "./faults.ts"
export { connectClerkUpstream } from "./upstream.ts"
export { CLERK_HOSTS, isClerkHost } from "./helpers.ts"
export { type ClerkInstanceView, clerkInstance } from "./inspect.ts"
export {
  type ClerkSeedConfig,
  type ClerkSeedOrganization,
  type ClerkSeedSocial,
  type ClerkSeedTemplate,
  type ClerkSeedUser,
  type ClerkSeedWebhook,
  seedClerk,
} from "./seed.ts"
export { stableClerkId } from "./helpers.ts"
export type {
  ClerkEmailView,
  ClerkEventType,
  ClerkInstance,
  ClerkMembershipView,
  ClerkMessage,
  ClerkOrganizationView,
  ClerkSessionView,
  ClerkSocialProvider,
  ClerkUserView,
} from "./views.ts"

/** What an error answer carries under `meta`: the Frontend API puts the browser's client there. */
type ErrorMeta = (c: Context) => Readonly<Record<string, unknown>> | undefined

/**
 * An error handler answering in Clerk's format: a list of `{message, long_message, code}`, the
 * `meta` from `meta` when it gives one, and a trace id.
 */
function clerkErrors(meta: ErrorMeta): ErrorHandler {
  return (error, c) => {
    if (error instanceof ClerkFailure)
      return c.json(clerkErrorBody([error.entry], meta(c)), error.status)

    const status = error instanceof HttpError ? error.status : 500
    const message = error instanceof Error ? error.message : "Internal server error"

    return c.json(
      clerkErrorBody(
        [
          {
            message,
            long_message: message,
            code: status === 404 ? "resource_not_found" : "internal_clerk_error",
          },
        ],
        meta(c),
      ),
      status,
    )
  }
}

/** A sub-app with Clerk's error answers. */
function clerkApp(meta: ErrorMeta = () => undefined): App {
  const app = new App()

  app.onError(clerkErrors(meta))

  return app
}

/** The browser's client, for a Frontend API error from a known dev browser. */
function clientMeta(context: ClerkContext): ErrorMeta {
  return (c) => {
    try {
      const request = browserRequest(c, context)

      return { client: browserClient(context, currentClient(context, request), request.azp) }
    } catch {
      return undefined
    }
  }
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
    if (host === IMAGE_HOST) return clerkImage(c.req.path)
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
    events: new ClerkEvents(emulator.store, emulator.outbox, emulator.clock),
  })
}

/**
 * Clerk on its real hosts for a development instance: the Backend API on `api.clerk.com` (users,
 * sessions and their tokens, organizations, memberships and invitations, sign-in tokens, JWT
 * templates, JWKS and handshake payloads); the Frontend API on `<slug>.clerk.accounts.dev` (the
 * handshake an app's middleware redirects through, and the public keys); and the Account Portal
 * on `<slug>.accounts.dev` (sign-in with a password or emailed code, sign-up, sign-in links).
 * Seeded social connections send ClerkJS's "Continue with Google" to the provider and back to
 * `/v1/oauth_callback`, once `connectClerkUpstream` gives the emulator a way to reach it.
 * Session tokens are RS256 JWTs with Clerk's claims, signed by a key per emulator.
 */
export const clerk = defineEmulator({
  name: "clerk",
  setup(emulator) {
    const context = contextFor(emulator)
    const apps = {
      backend: clerkApp(),
      frontend: clerkApp(clientMeta(context)),
      accounts: clerkApp(),
    }

    emulator.app.use(byHost(context, apps))
    apps.backend.use(backendAuth(emulator.store))
    userRoutes(apps.backend, context)
    sessionRoutes(apps.backend, context)
    organizationRoutes(apps.backend, context)
    instanceRoutes(apps.backend, context)
    apps.frontend.use(browserCors())
    apps.frontend.use(methodOverride(apps.frontend))
    apps.frontend.use(clerkScripts())
    frontendRoutes(apps.frontend, context)
    clientApiRoutes(apps.frontend, context)
    attemptRoutes(apps.frontend, context)
    oauthRoutes(apps.frontend, context)
    meApiRoutes(apps.frontend, context)
    ticketRoutes(apps.frontend, context)
    accountsRoutes(apps.accounts, context)
  },
  seed: ({ store }) => {
    store.setData(INSTANCE, instanceFrom())
  },
  webhooks: ({ store, clock, wallClock }) => ({
    endpoints: () => clerkEndpoints(store),
    sign: signedOnWallClock(clock, wallClock, ({ endpoint, body, timestamp }) =>
      clerkWebhookHeaders(endpoint.secret, body, timestamp, clerkCustomHeaders(store, endpoint.id)),
    ),
    policy: SVIX_DELIVERY,
  }),
})
