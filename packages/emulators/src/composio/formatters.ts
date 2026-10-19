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
import { OAUTH_CALLBACK } from "./helpers.ts"
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
    auth_config_details: toolkit.authSchemes.map((mode) => authConfigDetails(toolkit, mode)),
    auth_guide_url: null,
    ...toolkitApi(toolkit),
    meta: {
      ...toolkitMeta(toolkit, objects),
      categories: toolkit.categories.map((name) => ({ name, slug: name.replace(/\s+/g, "-") })),
      available_versions: [TOOLKIT_VERSION],
    },
  }
}

/** Where a toolkit's API lives and how Composio asks it who an account is, in both spellings. */
function toolkitApi(toolkit: ToolkitDefinition) {
  const currentUser = toolkit.currentUser?.url ?? ""

  return {
    base_url: toolkit.baseUrl ?? toolkit.appUrl ?? "",
    get_current_user_endpoint: currentUser,
    get_current_user_endpoint_method: toolkit.currentUser?.method ?? "GET",
    deprecated: {
      toolkitId: toolkit.slug,
      getCurrentUserEndpoint: currentUser,
      rawProxyInfoByAuthSchemes: toolkit.authSchemes.map((mode) => ({
        auth_method: mode,
        proxy: {},
      })),
    },
  }
}

/** One setting an auth config or a connection asks for, as the toolkit describes it. */
function field(name: string, displayName: string, description: string, fallback?: string) {
  return {
    name,
    displayName,
    description,
    type: "string",
    required: fallback === undefined,
    user_visible: true,
    ...(fallback !== undefined && { default: fallback }),
  }
}

/** What an auth config of `mode` for `toolkit` is made from: an OAuth client for OAuth2. */
function authConfigDetails(
  toolkit: ToolkitDefinition,
  mode: ToolkitDefinition["authSchemes"][number],
) {
  const oauth = mode === "OAUTH2"

  return {
    mode,
    name: `${toolkit.slug}_${oauth ? "oauth" : mode.toLowerCase()}`,
    required_scopes: [],
    fields: {
      auth_config_creation: {
        required: oauth
          ? [
              field("client_id", "Client id", "The OAuth app's client id."),
              field("client_secret", "Client secret", "The OAuth app's client secret."),
            ]
          : [],
        optional: oauth
          ? [
              field(
                "oauth_redirect_uri",
                "Redirect URI",
                "Where the provider sends the user back.",
                "",
              ),
              field(
                "scopes",
                "Scopes",
                "The scopes to ask for.",
                (toolkit.defaultScopes ?? []).join(","),
              ),
            ]
          : [],
      },
      connected_account_initiation: { required: [], optional: [] },
    },
    ...(oauth &&
      toolkit.oauth && {
        deprecated_auth_provider_details: {
          authorization_url: toolkit.oauth.authorizationUrl,
          token_url: toolkit.oauth.tokenUrl,
        },
      }),
    auth_hint_url: null,
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
    scope_requirements: scopeRequirements(tool),
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

/** The scopes a tool needs: every group met by any one of its scopes; null for a tool that needs none. */
function scopeRequirements(tool: ToolDefinition) {
  const groups = tool.scopeRequirements ?? (tool.scopes?.length ? [tool.scopes] : [])

  return groups.length > 0 ? { all_of: groups.map((group) => ({ any_of: [...group] })) } : null
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
    credentials: configCredentials(config),
    created_by: CREATED_BY,
    status: config.status,
    created_at: config.createdAt,
    last_updated_at: config.updatedAt,
    no_of_connections: objects.accounts.where((account) => account.authConfigId === config.id)
      .length,
    tool_access_config: {
      tools_for_connected_account_creation: [],
      tools_available_for_execution: [...config.restrictToTools],
    },
    is_enabled_for_tool_router: false,
  }
}

/** Who made auth configs that the API made: the project's key, as Composio records it. */
const CREATED_BY = "api_key"

/**
 * An auth config's credentials as the API shows them. An OAuth2 config always names a client and
 * the redirect URI: the app's own for a custom config, Composio's for a managed one.
 */
function configCredentials(config: AuthConfigRecord): Record<string, unknown> {
  const oauth =
    config.authScheme === "OAUTH2"
      ? {
          client_id: `composio-managed-${config.toolkit}`,
          client_secret: "********",
          oauth_redirect_uri: OAUTH_CALLBACK,
        }
      : {}

  return { ...oauth, ...config.credentials, scopes: [...config.scopes] }
}

/** A connected account's `state`: its scheme and credentials, with the status Composio nests in them. */
function accountState(account: ConnectedAccountRecord, scheme: string) {
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
    authScheme: scheme,
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
    experimental: {
      account_type: "PRIVATE",
      acl_config_for_shared: {
        allow_all_users: false,
        allowed_user_ids: [],
        not_allowed_user_ids: [],
      },
    },
    data: { ...account.val, status: account.status },
    status_reason: account.statusReason,
    is_disabled: account.disabled,
    /* The client's types still list `params`; the live API stopped sending it. */
  } satisfies Omit<ConnectedAccountRetrieveResponse, "state" | "params">

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
    requires_webhook_endpoint_setup: trigger.requiresWebhookSetup ?? false,
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
