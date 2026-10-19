import { defineEmulator } from "../define.ts"
import { HttpError } from "../errors.ts"
import type { Store } from "../store.ts"
import type { WebhookEndpoint } from "../webhooks.ts"
import { composioApiKey } from "./auth.ts"
import type { ComposioRouteContext } from "./context.ts"
import { ComposioEvents } from "./events.ts"
import { ComposioError, composioError } from "./helpers.ts"
import { authConfigRoutes } from "./routes/auth-configs.ts"
import { connectRoutes } from "./routes/connect.ts"
import { connectedAccountRoutes } from "./routes/connected-accounts.ts"
import { toolRoutes } from "./routes/tools.ts"
import { triggerRoutes, webhookSubscriptionRoutes } from "./routes/triggers.ts"
import { COMPOSIO_DELIVERY, composioWebhookHeaders } from "./signature.ts"
import { composioStore } from "./store.ts"

export { type ComposioBackends, connectComposioBackends } from "./backends/index.ts"
export { composioOutboundFaults } from "./faults.ts"
export { COMPOSIO_HOSTS, OAUTH_CALLBACK as COMPOSIO_OAUTH_CALLBACK } from "./helpers.ts"
export {
  type ComposioAccountView,
  type ComposioExecution,
  type ComposioProject,
  composioProject,
} from "./inspect.ts"
export {
  type ComposioTools,
  composioTools,
  type ToolAnswer as ComposioToolAnswer,
  type ToolCall as ComposioToolCall,
  type ToolHandler as ComposioToolHandler,
} from "./execute.ts"
export { composioWebhookHeaders as composioSignature } from "./signature.ts"
export {
  type ComposioSeedAccount,
  type ComposioSeedAuthConfig,
  type ComposioSeedConfig,
  type ComposioSeedResult,
  type ComposioSeedTool,
  type ComposioSeedTrigger,
  seedComposio,
} from "./seed.ts"

/** Where the project's events go: its one webhook subscription. */
function endpointsOf(store: Store): WebhookEndpoint[] {
  return composioStore(store)
    .subscriptions.all()
    .map((subscription) => ({
      id: subscription.id,
      url: subscription.url,
      events: subscription.events,
      secret: subscription.secret,
      enabled: true,
    }))
}

function routes(context: ComposioRouteContext): void {
  for (const register of [
    toolRoutes,
    authConfigRoutes,
    connectedAccountRoutes,
    connectRoutes,
    triggerRoutes,
    webhookSubscriptionRoutes,
  ])
    register(context)
}

/**
 * Composio (`backend.composio.dev`), the tool platform agents call: toolkits and tools, tool
 * execution, auth configs, connected accounts with hosted connect links, triggers and the
 * project's signed webhooks. Connected to the Google, Slack, GitHub or Microsoft emulator with
 * `connectComposioBackends`, accounts sign in on that emulator and tools act on its state.
 */
export const composio = defineEmulator({
  name: "composio",
  setup({ app, store, outbox, clock }) {
    app.onError((error, c) => {
      if (error instanceof ComposioError)
        return composioError(c, error.status, error.code, error.slug, error.message)

      const status = error instanceof HttpError ? error.status : 500
      const message = error instanceof Error ? error.message : "Internal server error"

      return composioError(
        c,
        status,
        status === 500 ? 500 : 302,
        status === 500 ? "Internal_ServerError" : "Request_Error",
        message,
      )
    })

    const objects = composioStore(store)

    app.use(composioApiKey(objects))
    routes({ app, store, clock, objects, events: new ComposioEvents(outbox, clock) })
  },
  webhooks: ({ store }) => ({
    endpoints: () => endpointsOf(store),
    sign: ({ endpoint, body, timestamp }) =>
      composioWebhookHeaders(endpoint.secret, body, timestamp),
    policy: COMPOSIO_DELIVERY,
  }),
})
