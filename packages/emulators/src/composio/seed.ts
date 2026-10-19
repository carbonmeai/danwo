import { isOneOf } from "../json.ts"
import type { Store } from "../store.ts"
import { newAccount } from "./accounts.ts"
import {
  AUTH_SCHEMES,
  type AuthConfigRecord,
  type AuthScheme,
  type JsonSchema,
  type ToolkitDefinition,
} from "./entities.ts"
import { EVENT_TYPES } from "./events.ts"
import { TOOLKIT_VERSION } from "./formatters.ts"
import { composioId, newUuid, secret, toolkitKey } from "./helpers.ts"
import { toolkitOf } from "./lookup.ts"
import { newAuthConfig } from "./routes/auth-configs.ts"
import { composioStore } from "./store.ts"

/** An auth config to start with; `custom` ones carry the app's own OAuth client in `credentials`. */
export type ComposioSeedAuthConfig = { readonly toolkit: string } & Partial<{
  readonly id: string
  readonly name: string
  readonly custom: boolean
  readonly authScheme: AuthScheme
  readonly credentials: Readonly<Record<string, unknown>>
  readonly scopes: readonly string[]
}>

/**
 * A connected account to start with, ACTIVE unless `status` says otherwise. It uses the auth
 * config named, or the toolkit's first one (a Composio-managed one is made when there is none).
 * `credentials` are its `state.val`: a backend token, say, so tools act on the backend emulator.
 */
export type ComposioSeedAccount = { readonly userId: string; readonly toolkit: string } & Partial<{
  readonly id: string
  readonly authConfig: string
  readonly status: "ACTIVE" | "EXPIRED" | "INACTIVE" | "FAILED"
  readonly credentials: Readonly<Record<string, unknown>>
  readonly label: string
  readonly alias: string
}>

/** What a tool answers when its arguments include every `match` field. */
export type ComposioSeedResult = { readonly tool: string } & Partial<{
  readonly match: Readonly<Record<string, unknown>>
  readonly data: unknown
  readonly error: string
  readonly successful: boolean
}>

/** A custom tool, on a custom toolkit or a built-in one. */
export type ComposioSeedTool = { readonly slug: string; readonly toolkit: string } & Partial<{
  readonly name: string
  readonly description: string
  readonly input: JsonSchema
  readonly noAuth: boolean
}>

/** A trigger set up on a seeded account. */
export type ComposioSeedTrigger = {
  readonly trigger: string
  readonly connectedAccount: string
} & Partial<{
  readonly id: string
  readonly config: Readonly<Record<string, unknown>>
}>

/** Data to load into a Composio emulator. */
export type ComposioSeedConfig = Partial<{
  /** The project's API keys; when given, only these are accepted. */
  readonly apiKeys: readonly string[]
  readonly toolkits: readonly (Pick<ToolkitDefinition, "slug" | "name"> &
    Partial<ToolkitDefinition>)[]
  readonly tools: readonly ComposioSeedTool[]
  readonly authConfigs: readonly ComposioSeedAuthConfig[]
  readonly connectedAccounts: readonly ComposioSeedAccount[]
  readonly triggers: readonly ComposioSeedTrigger[]
  /** The project's webhook subscription: where trigger and account events go. */
  readonly webhook: { readonly url: string } & Partial<{
    readonly secret: string
    readonly events: readonly string[]
  }>
  readonly results: readonly ComposioSeedResult[]
}>

function seedCatalog(store: Store, config: ComposioSeedConfig): void {
  const objects = composioStore(store)

  for (const toolkit of config.toolkits ?? [])
    objects.toolkits.add(
      {
        description: "",
        categories: [],
        authSchemes: ["API_KEY"],
        managed: false,
        ...toolkit,
        slug: toolkitKey(toolkit.slug),
        id: toolkitKey(toolkit.slug),
      },
      null,
    )

  for (const tool of config.tools ?? [])
    objects.tools.add(
      {
        name: tool.slug,
        description: "",
        input: { type: "object", properties: {} },
        ...tool,
        slug: tool.slug.toUpperCase(),
        toolkit: toolkitKey(tool.toolkit),
        id: tool.slug.toUpperCase(),
      },
      null,
    )
}

function seedAuthConfig(store: Store, seed: ComposioSeedAuthConfig): AuthConfigRecord {
  const objects = composioStore(store)
  const made = newAuthConfig({ objects, clock: store.clock }, toolkitKey(seed.toolkit), {
    type: seed.custom === true ? "use_custom_auth" : "use_composio_managed_auth",
    ...(seed.name !== undefined && { name: seed.name }),
    ...(isOneOf(AUTH_SCHEMES, seed.authScheme) && { authScheme: seed.authScheme }),
    credentials: { ...seed.credentials, ...(seed.scopes && { scopes: [...seed.scopes] }) },
  })

  if (seed.id === undefined) return made

  objects.authConfigs.remove(made.id)

  return objects.authConfigs.add({ ...made, id: seed.id }, null)
}

/** The auth config a seeded account uses: the one it names, the toolkit's first, or a new managed one. */
function configFor(store: Store, seed: ComposioSeedAccount): AuthConfigRecord {
  const objects = composioStore(store)
  const named = seed.authConfig === undefined ? undefined : objects.authConfigs.get(seed.authConfig)
  const toolkit = toolkitKey(seed.toolkit)

  return (
    named ??
    objects.authConfigs.where((c) => c.toolkit === toolkit)[0] ??
    seedAuthConfig(store, {
      toolkit,
      ...(toolkitOf(objects, toolkit)?.managed === false && { custom: true }),
    })
  )
}

function seedAccount(store: Store, seed: ComposioSeedAccount): void {
  const objects = composioStore(store)
  const account = newAccount({ objects, clock: store.clock }, configFor(store, seed), seed.userId, {
    status: seed.status ?? "ACTIVE",
    val: { ...(seed.credentials ?? { access_token: `emulated_${secret(16)}` }) },
    alias: seed.alias ?? null,
  })

  if (seed.id === undefined && seed.label === undefined) return

  objects.accounts.remove(account.id)
  objects.accounts.add({ ...account, id: seed.id ?? account.id, label: seed.label ?? null }, null)
}

function seedTriggers(store: Store, triggers: readonly ComposioSeedTrigger[]): void {
  const objects = composioStore(store)
  const now = store.clock().toISOString()

  for (const seed of triggers) {
    const account = objects.accounts.get(seed.connectedAccount)

    if (!account)
      throw new Error(
        `seeded trigger ${seed.trigger}: no connected account ${seed.connectedAccount}`,
      )

    objects.triggers.add(
      {
        id: seed.id ?? composioId("ti"),
        uuid: newUuid(),
        triggerName: seed.trigger.toUpperCase(),
        accountId: account.id,
        userId: account.userId,
        config: { ...seed.config },
        version: TOOLKIT_VERSION,
        disabledAt: null,
        createdAt: now,
        updatedAt: now,
      },
      null,
    )
  }
}

function seedWebhook(store: Store, webhook: ComposioSeedConfig["webhook"]): void {
  if (webhook === undefined) return

  const now = store.clock().toISOString()

  composioStore(store).subscriptions.add(
    {
      id: composioId("ws"),
      url: webhook.url,
      version: "V3",
      events: [...(webhook.events ?? [EVENT_TYPES.trigger, EVENT_TYPES.expired])],
      secret: webhook.secret ?? secret(),
      createdAt: now,
      updatedAt: now,
    },
    null,
  )
}

/** Loads `config` into a Composio emulator's store. No events are emitted for seeded data. */
export function seedComposio(store: Store, config: ComposioSeedConfig): void {
  const objects = composioStore(store)

  objects.addApiKeys(config.apiKeys ?? [])
  seedCatalog(store, config)
  for (const seed of config.authConfigs ?? []) seedAuthConfig(store, seed)
  for (const seed of config.connectedAccounts ?? []) seedAccount(store, seed)
  seedTriggers(store, config.triggers ?? [])
  seedWebhook(store, config.webhook)
  objects.addResults(
    (config.results ?? []).map((result) => ({
      tool: result.tool.toUpperCase(),
      match: { ...result.match },
      data: result.data ?? {},
      error: result.error ?? null,
      successful: result.successful ?? result.error === undefined,
    })),
  )
}
