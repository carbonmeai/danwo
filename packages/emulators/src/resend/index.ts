import { defineEmulator } from "../define.ts"
import { providerErrors } from "../errors.ts"
import type { Store } from "../store.ts"
import type { WebhookEndpoint } from "../webhooks.ts"
import { resendApiKey } from "./auth.ts"
import type { ResendRouteContext } from "./context.ts"
import { isEventType, type KeyPermission, type Region } from "./entities.ts"
import { ResendEvents } from "./events.ts"
import { domainObject } from "./formatters.ts"
import { newUuid, resendError } from "./helpers.ts"
import { apiKeyRoutes } from "./routes/api-keys.ts"
import { domainRoutes } from "./routes/domains.ts"
import { emailRoutes, setAllowlist } from "./routes/emails.ts"
import { webhookRoutes } from "./routes/webhooks.ts"
import { RESEND_DELIVERY, resendSigningSecret, resendWebhookHeaders } from "./signature.ts"
import { resendStore } from "./store.ts"

export { resendOutboundFaults } from "./faults.ts"
export { type InboxEmail, type ResendInbox, resendInbox } from "./inbox.ts"

/** Data to load into a Resend emulator. */
export type ResendSeedConfig = Partial<{
  /** When set, only these addresses may receive mail, as on a sandboxed account. */
  readonly allowlist: readonly string[]
  readonly domains: readonly { readonly name: string; readonly region?: Region }[]
  /**
   * API keys the account has issued. Any `re_` key is accepted anyway; seed one with
   * `permission: "sending_access"` to have reads refused with it, as a sending-only key is.
   */
  readonly keys: readonly {
    readonly name: string
    readonly token: string
    readonly permission?: KeyPermission
  }[]
  /** Endpoints to deliver webhooks to; without a `secret`, a random one. */
  readonly webhooks: readonly {
    readonly endpoint: string
    readonly events: readonly string[]
    readonly secret?: string
  }[]
}>

/** Loads `config` into a Resend emulator's store. No events are emitted for seeded data. */
export function seedResend(store: Store, config: ResendSeedConfig): void {
  const objects = resendStore(store)
  const createdAt = store.clock().toISOString()

  if (config.allowlist) setAllowlist({ store }, config.allowlist)

  for (const domain of config.domains ?? [])
    objects.domains.add(
      domainObject({
        id: newUuid(),
        name: domain.name,
        region: domain.region ?? "us-east-1",
        createdAt,
      }),
      null,
    )

  for (const key of config.keys ?? [])
    objects.keys.add(
      { id: newUuid(), name: key.name, created_at: createdAt, last_used_at: null },
      { token: key.token, permission: key.permission ?? "full_access" },
    )

  for (const webhook of config.webhooks ?? [])
    objects.webhooks.add(
      {
        object: "webhook",
        id: newUuid(),
        created_at: createdAt,
        status: "enabled",
        endpoint: webhook.endpoint,
        events: webhook.events.filter(isEventType),
        signing_secret: webhook.secret ?? resendSigningSecret(),
      },
      null,
    )
}

/** Where webhooks go, with their signing secrets. */
function endpointsOf(store: Store): WebhookEndpoint[] {
  return resendStore(store)
    .webhooks.all()
    .map((webhook) => ({
      id: webhook.id,
      url: webhook.endpoint,
      events: webhook.events ?? ["*"],
      secret: webhook.signing_secret,
      enabled: webhook.status === "enabled",
    }))
}

function routes(context: ResendRouteContext): void {
  for (const register of [emailRoutes, domainRoutes, apiKeyRoutes, webhookRoutes]) register(context)
}

/** The Resend API (`api.resend.com`): sending email, domains, API keys and webhooks. */
export const resend = defineEmulator({
  name: "resend",
  setup({ app, store, outbox, clock }) {
    app.onError(
      providerErrors((c, status, message) => resendError(c, status, "application_error", message)),
    )
    const objects = resendStore(store)

    app.use(resendApiKey(objects))
    routes({
      app,
      store,
      clock,
      objects,
      events: new ResendEvents(outbox, clock),
    })
  },
  webhooks: ({ store }) => ({
    endpoints: () => endpointsOf(store),
    sign: ({ endpoint, body, timestamp }) => resendWebhookHeaders(endpoint.secret, body, timestamp),
    policy: RESEND_DELIVERY,
  }),
})
