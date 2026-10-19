/** The emulator's records as the Composio API writes them. */
import type {
  AuthConfigRetrieveResponse,
  ConnectedAccountRetrieveResponse,
  ToolkitListResponse,
  ToolkitRetrieveResponse,
  ToolRetrieveResponse,
  TriggerInstanceListActiveResponse,
  TriggersTypeRetrieveResponse,
} from "@composio/client/resources"
import type { WebhookSubscriptionRetrieveResponse } from "@composio/client/resources/webhook-subscriptions"

import type {
  AuthConfigRecord,
  ConnectedAccountRecord,
  ToolDefinition,
  ToolkitDefinition,
  TriggerInstanceRecord,
  TriggerTypeDefinition,
  WebhookSubscriptionRecord,
} from "./entities.ts"
import { allTools, allTriggerTypes, toolkitName } from "./lookup.ts"
import type { ComposioStore } from "./store.ts"

/** Every toolkit is at this version in the emulator; tools and triggers report it too. */
export const TOOLKIT_VERSION = "20250901_00"

const logo = (slug: string): string => `https://logos.composio.dev/api/${slug}`

const EPOCH = "2025-01-01T00:00:00.000Z"

function toolkitMeta(toolkit: ToolkitDefinition, objects: ComposioStore) {
  return {
    created_at: EPOCH,
    updated_at: EPOCH,
    description: toolkit.description,
    logo: logo(toolkit.slug),
    app_url: toolkit.appUrl ?? null,
    triggers_count: allTriggerTypes(objects).filter((t) => t.toolkit === toolkit.slug).length,
    tools_count: allTools(objects).filter((tool) => tool.toolkit === toolkit.slug).length,
    version: TOOLKIT_VERSION,
  }
}

/** A toolkit as `GET /toolkits` lists it. */
export function listedToolkit(
  toolkit: ToolkitDefinition,
  objects: ComposioStore,
): ToolkitListResponse["items"][number] {
  return {
    slug: toolkit.slug,
    name: toolkit.name,
    type: "native",
    auth_schemes: [...toolkit.authSchemes],
    composio_managed_auth_schemes: toolkit.managed ? ["OAUTH2"] : [],
    is_local_toolkit: false,
    no_auth: toolkit.authSchemes.includes("NO_AUTH"),
    deprecated: { toolkitId: toolkit.slug },
    meta: {
      ...toolkitMeta(toolkit, objects),
      categories: toolkit.categories.map((name) => ({ id: name.replace(/\s+/g, "-"), name })),
    },
  }
}

/** A toolkit as `GET /toolkits/{slug}` reads it. */
export function toolkitObject(
  toolkit: ToolkitDefinition,
  objects: ComposioStore,
): ToolkitRetrieveResponse {
  return {
    slug: toolkit.slug,
    name: toolkit.name,
    type: "native",
    enabled: true,
    composio_managed_auth_schemes: toolkit.managed ? ["OAUTH2"] : [],
    composio_managed_auth: toolkit.managed
      ? [{ mode: "OAUTH2", scopes: { available: [...(toolkit.defaultScopes ?? [])] } }]
      : [],
    is_local_toolkit: false,
    auth_config_details: toolkit.authSchemes.map((mode) => ({
      mode,
      name: mode,
      required_scopes: [],
      fields: {
        auth_config_creation: { required: [], optional: [] },
        connected_account_initiation: { required: [], optional: [] },
      },
    })),
    meta: {
      ...toolkitMeta(toolkit, objects),
      categories: toolkit.categories.map((name) => ({ name, slug: name.replace(/\s+/g, "-") })),
      available_versions: [TOOLKIT_VERSION],
    },
    deprecated: { toolkitId: toolkit.slug, rawProxyInfoByAuthSchemes: [] },
  }
}

/** A tool as `GET /tools` and `GET /tools/{slug}` write it. */
export function toolObject(tool: ToolDefinition, objects: ComposioStore): ToolRetrieveResponse {
  return {
    slug: tool.slug,
    name: tool.name,
    description: tool.description,
    human_description: tool.description,
    toolkit: {
      slug: tool.toolkit,
      name: toolkitName(objects, tool.toolkit),
      logo: logo(tool.toolkit),
    },
    input_parameters: { ...tool.input, title: `${tool.name}Request` },
    output_parameters: tool.output
      ? { ...tool.output }
      : {
          type: "object",
          properties: {
            data: { type: "object", title: "Data" },
            error: { type: "string", nullable: true, title: "Error" },
            successful: { type: "boolean", title: "Successful" },
          },
          required: ["data", "successful"],
        },
    no_auth: tool.noAuth ?? false,
    available_versions: [TOOLKIT_VERSION],
    version: TOOLKIT_VERSION,
    scopes: [...(tool.scopes ?? [])],
    scope_requirements: null,
    tags: [...(tool.tags ?? [])],
    is_deprecated: false,
    deprecated: {
      displayName: tool.name,
      version: TOOLKIT_VERSION,
      available_versions: [TOOLKIT_VERSION],
      is_deprecated: false,
      toolkit: { logo: logo(tool.toolkit) },
    },
  }
}

/** An auth config as `GET /auth_configs/{id}` reads it. */
export function authConfigObject(
  config: AuthConfigRecord,
  objects: ComposioStore,
): AuthConfigRetrieveResponse {
  return {
    id: config.id,
    uuid: config.uuid,
    type: config.type,
    toolkit: { slug: config.toolkit, logo: logo(config.toolkit) },
    name: config.name,
    auth_scheme: config.authScheme,
    is_composio_managed: config.managed,
    credentials: { ...config.credentials, scopes: [...config.scopes] },
    status: config.status,
    created_at: config.createdAt,
    last_updated_at: config.updatedAt,
    no_of_connections: objects.accounts.where((account) => account.authConfigId === config.id)
      .length,
    restrict_to_following_tools: [...config.restrictToTools],
    tool_access_config: {},
    is_enabled_for_tool_router: false,
  }
}

/** A connected account's `state`: its scheme and credentials, with the status Composio nests in them. */
export function accountState(account: ConnectedAccountRecord, scheme: string) {
  return { authScheme: scheme, val: { ...account.val, status: account.status } }
}

/** A connected account as `GET /connected_accounts/{id}` reads it. */
export function connectedAccountObject(
  account: ConnectedAccountRecord,
  config: AuthConfigRecord | undefined,
) {
  const scheme = config?.authScheme ?? "OAUTH2"
  const wire = {
    toolkit: { slug: account.toolkit },
    auth_config: {
      id: account.authConfigId,
      auth_scheme: scheme,
      is_composio_managed: config?.managed ?? true,
      is_disabled: config?.status === "DISABLED",
    },
    id: account.id,
    word_id: account.wordId,
    alias: account.alias,
    user_id: account.userId,
    status: account.status,
    created_at: account.createdAt,
    updated_at: account.updatedAt,
    data: { ...account.val, status: account.status },
    params: { ...account.val, status: account.status },
    status_reason: account.statusReason,
    is_disabled: account.disabled,
  } satisfies Omit<ConnectedAccountRetrieveResponse, "state">

  return { ...wire, state: accountState(account, scheme) }
}

/** A trigger type as `GET /triggers_types/{slug}` reads it. */
export function triggerTypeObject(
  trigger: TriggerTypeDefinition,
  objects: ComposioStore,
): TriggersTypeRetrieveResponse {
  return {
    slug: trigger.slug,
    name: trigger.name,
    description: trigger.description,
    instructions: trigger.description,
    type: trigger.type,
    toolkit: {
      slug: trigger.toolkit,
      name: toolkitName(objects, trigger.toolkit),
      logo: logo(trigger.toolkit),
    },
    config: { ...trigger.config, title: `${trigger.name}Config` },
    payload: { ...trigger.payload, title: `${trigger.name}Payload` },
    version: TOOLKIT_VERSION,
  }
}

/** An active trigger as `GET /trigger_instances/active` lists it. */
export function triggerInstanceObject(
  trigger: TriggerInstanceRecord,
): TriggerInstanceListActiveResponse["items"][number] {
  return {
    uuid: trigger.uuid,
    id: trigger.id,
    connected_account_id: trigger.accountId,
    connected_account_uuid: trigger.accountId,
    trigger_name: trigger.triggerName,
    user_id: trigger.userId,
    version: trigger.version,
    trigger_config: { ...trigger.config },
    egress_url: null,
    state: {},
    updated_at: trigger.updatedAt,
    disabled_at: trigger.disabledAt,
    disabledAt: trigger.disabledAt,
    connectedAccountId: trigger.accountId,
    triggerName: trigger.triggerName,
    updatedAt: trigger.updatedAt,
    triggerConfig: { ...trigger.config },
    deprecated: { createdAt: trigger.createdAt },
  }
}

/** The project's webhook subscription as the API reads it. */
export function subscriptionObject(
  subscription: WebhookSubscriptionRecord,
): WebhookSubscriptionRetrieveResponse {
  return {
    id: subscription.id,
    webhook_url: subscription.url,
    version: subscription.version,
    enabled_events: [...subscription.events],
    secret: subscription.secret,
    created_at: subscription.createdAt,
    updated_at: subscription.updatedAt,
  }
}
