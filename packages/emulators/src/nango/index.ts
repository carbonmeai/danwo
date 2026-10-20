import { defineEmulator } from "../define.ts"
import type { Emulator } from "../define.ts"
import { HttpError } from "../errors.ts"
import type { Store } from "../store.ts"
import type { WebhookEndpoint } from "../webhooks.ts"
import { connect, connectionOf } from "./connections.ts"
import {
  NANGO_DELIVERY,
  NangoError,
  nangoError,
  type NangoRouteContext,
  nangoWebhookHeaders,
} from "./helpers.ts"
import { apiRoutes } from "./routes/api.ts"
import { connectUiRoutes } from "./routes/connect.ts"
import {
  type NangoActionOutput,
  type NangoCall,
  type NangoConnection,
  type NangoProxyAnswer,
  nangoStore,
} from "./store.ts"

export { connectNangoBackends, type NangoBackendName, type NangoBackends } from "./backends.ts"
export { nangoOutboundFaults } from "./faults.ts"
export { NANGO_HOSTS, nangoWebhookHeaders as nangoSignature } from "./helpers.ts"
export type { NangoActionOutput, NangoCall, NangoConnection, NangoProxyAnswer } from "./store.ts"

/** An integration set up in the environment: its unique key and the provider it connects to. */
export interface NangoSeedIntegration {
  readonly key: string
  readonly provider?: string
  readonly name?: string
}

/** A connection that already exists, optionally with credentials a backend emulator issued. */
export interface NangoSeedConnection {
  readonly integration: string
  readonly connectionId: string
  readonly endUser?: {
    readonly id: string
    readonly email?: string
    readonly display_name?: string
  }
  readonly accessToken?: string
  readonly metadata?: Readonly<Record<string, unknown>>
}

/** Data to load into a Nango emulator. No webhooks are sent for seeded data. */
export type NangoSeedConfig = Partial<{
  /** The environment's secret keys; when none are given, any non-empty key is accepted. */
  secretKeys: readonly string[]
  integrations: readonly NangoSeedIntegration[]
  connections: readonly NangoSeedConnection[]
  /** The environment's webhook URL; `secret` signs them (else the first secret key, as Nango does). */
  webhook: { readonly url: string; readonly secret?: string }
  /** Answers for proxied calls to integrations without a backend emulator. */
  proxy: readonly NangoProxyAnswer[]
  actions: readonly NangoActionOutput[]
  records: readonly {
    readonly connectionId: string
    readonly model: string
    readonly records: readonly unknown[]
  }[]
}>

const silent = { push: () => ({ id: 0, topic: "", body: null, createdAt: "" }) }

/** Loads `config` into a Nango emulator's store. */
export function seedNango(store: Store, config: NangoSeedConfig): void {
  const objects = nangoStore(store)
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- seeding sends no webhooks and registers no routes
  const context = {
    objects,
    store,
    clock: store.clock,
    outbox: silent,
    app: undefined,
  } as unknown as NangoRouteContext

  if (config.secretKeys?.length) objects.secretKeys.add(config.secretKeys)
  for (const integration of config.integrations ?? []) seedIntegration(store, integration)
  for (const seed of config.connections ?? []) seedConnection(context, seed)
  seedExtras(objects, config)
}

/** The webhook URL, proxy answers, actions and records a seed names. */
function seedExtras(objects: ReturnType<typeof nangoStore>, config: NangoSeedConfig): void {
  if (config.webhook) objects.setWebhook(config.webhook)
  if (config.proxy) objects.answers.add(config.proxy)
  if (config.actions) objects.actions.add(config.actions)
  if (config.records)
    objects.records.add(
      config.records.map((r) => ({
        connection_id: r.connectionId,
        model: r.model,
        records: [...r.records],
      })),
    )
}

function seedIntegration(store: Store, integration: NangoSeedIntegration): void {
  const now = store.clock().toISOString()
  const provider = integration.provider ?? integration.key

  nangoStore(store).integrations.add(
    {
      id: integration.key,
      unique_key: integration.key,
      provider,
      display_name: integration.name ?? integration.key,
      logo: `https://app.nango.dev/images/template-logos/${provider}.svg`,
      created_at: now,
      updated_at: now,
    },
    null,
  )
}

function seedConnection(context: NangoRouteContext, seed: NangoSeedConnection): void {
  const { connection } = connect(context, {
    integration: seed.integration,
    connectionId: seed.connectionId,
    endUser: seed.endUser ?? null,
  })
  const token = seed.accessToken

  context.objects.connections.change(connection.id, {
    ...(seed.metadata && { metadata: { ...seed.metadata } }),
    ...(token && {
      credentials: { ...connection.credentials, access_token: token, raw: { access_token: token } },
    }),
  })
}

/** Reading a Nango emulator from a test, and breaking a connection as a revoked app does. */
export interface NangoProject {
  connections(): NangoConnection[]
  connection(integration: string, connectionId: string): NangoConnection
  /** Every proxied call and action run, oldest first. */
  calls(): NangoCall[]
  /** The connection's credentials stop refreshing: its next refresh fails with an `auth` webhook. */
  revoke(integration: string, connectionId: string): void
}

/** The Nango environment an emulator stands in for. */
export function nangoProject(emulator: Emulator): NangoProject {
  const objects = nangoStore(emulator.store)
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- reading registers no routes
  const context = {
    objects,
    store: emulator.store,
    clock: emulator.store.clock,
    outbox: emulator.outbox,
    app: undefined,
  } as unknown as NangoRouteContext

  return {
    connections: () => objects.connections.all(),
    connection: (integration, id) => connectionOf(context, integration, id),
    calls: () => objects.calls.all(),
    revoke(integration, id) {
      const connection = connectionOf(context, integration, id)

      objects.connections.change(connection.id, {
        broken: true,
        credentials: { ...connection.credentials, expires_at: new Date(0).toISOString() },
      })
    },
  }
}

/** Where the environment's webhooks go: its one webhook URL. */
function endpointsOf(store: Store): WebhookEndpoint[] {
  const objects = nangoStore(store)
  const webhook = objects.webhook()
  const secret = webhook?.secret ?? objects.secretKeys.all()[0] ?? ""

  return webhook ? [{ id: "nango", url: webhook.url, events: ["*"], secret, enabled: true }] : []
}

/**
 * Nango (`api.nango.dev`, with its Connect UI on `connect.nango.dev`): integrations, connect and
 * reconnect sessions, connections with credentials that refresh on the emulator's clock, the
 * proxy (forwarded to a backend emulator when one is connected, else answered from seeds),
 * actions, records, and signed `auth` webhooks.
 */
export const nango = defineEmulator({
  name: "nango",
  setup({ app, store, outbox, clock }) {
    app.onError((error, c) => {
      if (error instanceof NangoError) return nangoError(c, error.status, error.code, error.message)

      const status = error instanceof HttpError ? error.status : 500

      return nangoError(
        c,
        status,
        status === 500 ? "server_error" : "invalid_request",
        error instanceof Error ? error.message : "Server error",
      )
    })

    const context = { app, store, outbox, clock, objects: nangoStore(store) }

    apiRoutes(context)
    connectUiRoutes(context)
  },
  webhooks: ({ store }) => ({
    endpoints: () => endpointsOf(store),
    sign: ({ endpoint, body }) => nangoWebhookHeaders(endpoint.secret, body),
    policy: NANGO_DELIVERY,
  }),
})
