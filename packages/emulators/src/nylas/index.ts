import { defineEmulator } from "../define.ts"
import { HttpError } from "../errors.ts"
import type { Store } from "../store.ts"
import type { WebhookEndpoint } from "../webhooks.ts"
import { NYLAS_DELIVERY, NylasEvents, nylasWebhookHeaders } from "./events.ts"
import { NylasError, type NylasRouteContext, nylasError } from "./helpers.ts"
import { calendarRoutesAll } from "./routes/calendar.ts"
import { connectRoutes } from "./routes/connect.ts"
import { mailRoutes } from "./routes/mail.ts"
import { peopleRoutes } from "./routes/people.ts"
import { schedulingRoutes } from "./routes/scheduling.ts"
import { nylasStore } from "./store.ts"

export {
  NYLAS_TRIGGERS,
  type NylasTrigger,
  nylasWebhookHeaders as nylasSignature,
} from "./events.ts"
export { nylasOutboundFaults } from "./faults.ts"
export { NYLAS_HOSTS } from "./helpers.ts"
export { type NylasApplication, nylasApplication } from "./inspect.ts"
export type { NylasEvent, NylasGrant, NylasMessage } from "./entities.ts"
export {
  type NylasSeedConfig,
  type NylasSeedEvent,
  type NylasSeedGrant,
  type NylasSeedMessage,
  seedNylas,
} from "./seed.ts"

/** Where the application's notifications go: its active webhook subscriptions. */
function endpointsOf(store: Store): WebhookEndpoint[] {
  return nylasStore(store)
    .webhooks.all()
    .map((webhook) => ({
      id: webhook.id,
      url: webhook.webhook_url,
      events: webhook.trigger_types,
      secret: webhook.webhook_secret,
      enabled: webhook.status === "active",
    }))
}

function routes(context: NylasRouteContext): void {
  for (const register of [
    connectRoutes,
    peopleRoutes,
    mailRoutes,
    calendarRoutesAll,
    schedulingRoutes,
  ])
    register(context)
}

/**
 * Nylas v3 (`api.us.nylas.com`, `api.eu.nylas.com`): hosted authentication and grants, email
 * (messages, threads, drafts, folders, attachments), calendars and events with free/busy,
 * contacts, the scheduler's configurations, availability and bookings, and signed webhooks. Mail
 * sent between two connected grants lands in the other's inbox.
 */
export const nylas = defineEmulator({
  name: "nylas",
  setup({ app, store, outbox, clock }) {
    app.onError((error, c) => {
      if (error instanceof NylasError) return nylasError(c, error.status, error.type, error.message)

      const status = error instanceof HttpError ? error.status : 500
      const message = error instanceof Error ? error.message : "Internal error"

      return nylasError(c, status, status === 500 ? "api_error" : "invalid_request_error", message)
    })

    const objects = nylasStore(store)

    routes({
      app,
      store,
      clock,
      objects,
      events: new NylasEvents(outbox, clock, objects.applicationId),
    })
  },
  webhooks: ({ store }) => ({
    endpoints: () => endpointsOf(store),
    sign: ({ endpoint, body }) => nylasWebhookHeaders(endpoint.secret, body),
    policy: NYLAS_DELIVERY,
  }),
})
