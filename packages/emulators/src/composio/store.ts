import { objectTable } from "../objects.ts"
import type { DataKey, Store } from "../store.ts"
import type {
  AuthConfigRecord,
  ConnectedAccountRecord,
  ExecutionRecord,
  LinkRecord,
  ToolDefinition,
  ToolkitDefinition,
  TriggerInstanceRecord,
  TriggerTypeDefinition,
  WebhookSubscriptionRecord,
} from "./entities.ts"

/** A seeded answer for a tool: returned when its arguments include every `match` field. */
export interface SeededResult {
  readonly tool: string
  readonly match: Readonly<Record<string, unknown>>
  readonly data: unknown
  readonly error: string | null
  readonly successful: boolean
}

const API_KEYS: DataKey<string[]> = { name: "composio.api_keys" }
const RESULTS: DataKey<SeededResult[]> = { name: "composio.results" }
const COUNTER: DataKey<number> = { name: "composio.counter" }

/** The Composio objects held in an emulator's store. */
export function composioStore(store: Store) {
  return {
    authConfigs: objectTable<AuthConfigRecord>(store, "composio.auth_configs"),
    accounts: objectTable<ConnectedAccountRecord>(store, "composio.connected_accounts"),
    links: objectTable<LinkRecord>(store, "composio.links"),
    triggers: objectTable<TriggerInstanceRecord>(store, "composio.trigger_instances"),
    subscriptions: objectTable<WebhookSubscriptionRecord>(store, "composio.webhook_subscriptions"),
    executions: objectTable<ExecutionRecord>(store, "composio.executions"),
    /** Custom toolkits, tools and trigger types a seed added to the catalogue. */
    toolkits: objectTable<ToolkitDefinition & { id: string }>(store, "composio.toolkits"),
    tools: objectTable<Omit<ToolDefinition, "sample"> & { id: string }>(store, "composio.tools"),
    triggerTypes: objectTable<TriggerTypeDefinition & { id: string }>(
      store,
      "composio.trigger_types",
    ),
    /** The project keys accepted; when none are seeded, any `ak_` key is. */
    apiKeys: () => store.getData(API_KEYS) ?? [],
    addApiKeys: (keys: readonly string[]) => store.appendData(API_KEYS, keys),
    results: () => store.getData(RESULTS) ?? [],
    addResults: (results: readonly SeededResult[]) => store.appendData(RESULTS, results),
    /** A number that goes up by one on every call, for sample ids. */
    next(): number {
      const n = (store.getData(COUNTER) ?? 0) + 1

      store.setData(COUNTER, n)

      return n
    },
  }
}

export type ComposioStore = ReturnType<typeof composioStore>
