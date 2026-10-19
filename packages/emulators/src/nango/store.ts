/** Nango's objects: integrations, connections and their credentials, connect sessions, and what tests seed. */
import { objectTable } from "../objects.ts"
import type { DataKey, Store } from "../store.ts"

/** An integration: a provider set up in the Nango environment under a unique key. */
export interface NangoIntegration {
  id: string
  unique_key: string
  provider: string
  display_name: string
  logo: string
  created_at: string
  updated_at: string
}

/** Who a connection belongs to in the app, as a connect session names them. */
export interface NangoEndUser {
  id: string
  email?: string
  display_name?: string
  tags?: Record<string, string>
}

export interface NangoCredentials {
  type: "OAUTH2"
  access_token: string
  refresh_token: string
  expires_at: string
  raw: Record<string, unknown>
}

export interface NangoConnection {
  /** The key the table uses: the integration and the connection id together. */
  id: string
  numeric_id: number
  connection_id: string
  provider_config_key: string
  provider: string
  created_at: string
  updated_at: string
  last_fetched_at: string
  metadata: Record<string, unknown>
  connection_config: Record<string, unknown>
  end_user: NangoEndUser | null
  tags: Record<string, string>
  credentials: NangoCredentials
  /** Refreshing fails, as when the provider revoked the app: set by tests. */
  broken: boolean
}

export interface NangoSession {
  id: string
  end_user: NangoEndUser | null
  organization: Record<string, unknown> | null
  allowed_integrations: string[] | null
  tags: Record<string, string>
  expires_at: string
  /** For a reconnect session: the connection it renews. */
  reconnect: { connection_id: string; integration_id: string } | null
}

/**
 * A seeded answer for a proxied call: the first whose integration, method and path match. A path
 * ending in `*` matches every path that starts with what comes before it.
 */
export interface NangoProxyAnswer {
  readonly integration?: string
  readonly method?: string
  readonly path: string
  readonly status?: number
  readonly body: unknown
}

/** A seeded action's output, by integration and action name. */
export interface NangoActionOutput {
  readonly integration: string
  readonly name: string
  readonly output: unknown
}

/** A proxied or action call as Nango received it, for tests to read. */
export interface NangoCall {
  id: string
  kind: "proxy" | "action"
  connection_id: string
  integration: string
  method: string
  path: string
  body: unknown
  status: number
}

const SECRET_KEYS: DataKey<string[]> = { name: "nango.secret_keys" }
const WEBHOOK: DataKey<{ url: string; secret?: string }> = { name: "nango.webhook" }
const ANSWERS: DataKey<NangoProxyAnswer[]> = { name: "nango.proxy_answers" }
const ACTIONS: DataKey<NangoActionOutput[]> = { name: "nango.actions" }
const RECORDS: DataKey<{ connection_id: string; model: string; records: unknown[] }[]> = {
  name: "nango.records",
}
const COUNTER: DataKey<number> = { name: "nango.counter" }

/** The Nango objects held in an emulator's store. */
export function nangoStore(store: Store) {
  const list = <T>(key: DataKey<T[]>) => ({
    all: () => store.getData(key) ?? [],
    add: (items: readonly T[]) => store.setData(key, [...(store.getData(key) ?? []), ...items]),
  })

  return {
    integrations: objectTable<NangoIntegration>(store, "nango.integrations"),
    connections: objectTable<NangoConnection>(store, "nango.connections"),
    sessions: objectTable<NangoSession>(store, "nango.sessions"),
    calls: objectTable<NangoCall>(store, "nango.calls"),
    /** The environment's secret keys; when none are seeded, any non-empty key is accepted. */
    secretKeys: list(SECRET_KEYS),
    answers: list(ANSWERS),
    actions: list(ACTIONS),
    records: list(RECORDS),
    /** Where the environment's webhooks go, and the key they are signed with. */
    webhook: () => store.getData(WEBHOOK),
    setWebhook: (webhook: { url: string; secret?: string }) => store.setData(WEBHOOK, webhook),
    /** A number that goes up by one on every call, for connection ids. */
    next(): number {
      const n = (store.getData(COUNTER) ?? 0) + 1

      store.setData(COUNTER, n)

      return n
    },
  }
}

export type NangoStore = ReturnType<typeof nangoStore>

/** The table key of a connection: its integration and its id. */
export const connectionKey = (integration: string, connectionId: string) =>
  `${integration}:${connectionId}`
