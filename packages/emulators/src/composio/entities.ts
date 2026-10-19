/** The records a Composio emulator keeps: catalogue entries, auth configs, accounts and triggers. */

/** How a toolkit's accounts authenticate. */
export const AUTH_SCHEMES = [
  "OAUTH2",
  "OAUTH1",
  "API_KEY",
  "BASIC",
  "BEARER_TOKEN",
  "NO_AUTH",
] as const

export type AuthScheme = (typeof AUTH_SCHEMES)[number]

/** A connected account's lifecycle, as Composio reports it. */
export const ACCOUNT_STATUSES = [
  "INITIALIZING",
  "INITIATED",
  "ACTIVE",
  "FAILED",
  "EXPIRED",
  "INACTIVE",
  "REVOKED",
] as const

export type AccountStatus = (typeof ACCOUNT_STATUSES)[number]

/** A JSON schema object, as tool inputs and outputs are described. */
export interface JsonSchema {
  readonly type: "object"
  readonly properties: Readonly<Record<string, unknown>>
  readonly required?: readonly string[]
}

/** What a tool returns when nothing more specific answers: its data, from the call's arguments. */
export type SampleData = (args: Readonly<Record<string, unknown>>, n: number) => unknown

/** A tool in the catalogue. */
export interface ToolDefinition {
  readonly slug: string
  readonly name: string
  readonly description: string
  /** The toolkit's slug, lower case. */
  readonly toolkit: string
  readonly input: JsonSchema
  readonly output?: JsonSchema
  readonly scopes?: readonly string[]
  /**
   * The scopes the tool needs, as groups that must all be met by any one of their scopes. Without
   * it, any one of `scopes` will do.
   */
  readonly scopeRequirements?: readonly (readonly string[])[]
  readonly tags?: readonly string[]
  /** Runs without a connected account. */
  readonly noAuth?: boolean
  /** The data a call returns without a backend or a seeded result. */
  readonly sample?: SampleData
}

/** A toolkit in the catalogue. */
export interface ToolkitDefinition {
  readonly slug: string
  readonly name: string
  readonly description: string
  readonly categories: readonly string[]
  readonly authSchemes: readonly AuthScheme[]
  /** Composio holds an OAuth app for it, so an auth config needs no client of its own. */
  readonly managed: boolean
  readonly appUrl?: string
  /** Scopes a Composio-managed connection asks for. */
  readonly defaultScopes?: readonly string[]
  /** Where the toolkit's API lives, which proxied calls are relative to. */
  readonly baseUrl?: string
  /** The call Composio makes to learn who an account belongs to. */
  readonly currentUser?: { readonly method: string; readonly url: string }
  /** The provider's own OAuth endpoints, for an OAuth2 toolkit. */
  readonly oauth?: { readonly authorizationUrl: string; readonly tokenUrl: string }
}

/** A trigger type in the catalogue. */
export interface TriggerTypeDefinition {
  readonly slug: string
  readonly name: string
  readonly description: string
  readonly toolkit: string
  readonly type: "webhook" | "poll"
  /** The app must register a webhook endpoint with the provider before it fires. */
  readonly requiresWebhookSetup?: boolean
  readonly config: JsonSchema
  readonly payload: JsonSchema
}

/** An auth config: how a toolkit's accounts connect, with whose OAuth app. */
export interface AuthConfigRecord {
  readonly id: string
  readonly uuid: string
  readonly name: string
  readonly toolkit: string
  readonly type: "default" | "custom"
  readonly authScheme: AuthScheme
  readonly managed: boolean
  /** The custom app's credentials (client id and secret, scopes); empty when Composio's. */
  readonly credentials: Readonly<Record<string, unknown>>
  readonly scopes: readonly string[]
  readonly restrictToTools: readonly string[]
  readonly status: "ENABLED" | "DISABLED"
  readonly createdAt: string
  readonly updatedAt: string
}

/** A user's connection to a toolkit, with the credentials tools run with. */
export interface ConnectedAccountRecord {
  readonly id: string
  readonly uuid: string
  readonly userId: string
  readonly authConfigId: string
  readonly toolkit: string
  readonly status: AccountStatus
  readonly statusReason: string | null
  readonly alias: string | null
  readonly wordId: string
  readonly disabled: boolean
  /** The connection's credentials and fields, as Composio's `state.val`. */
  readonly val: Readonly<Record<string, unknown>>
  /** Who the account is at the toolkit, once connected (an email, a login). */
  readonly label: string | null
  readonly createdAt: string
  readonly updatedAt: string
}

/** A hosted connect link handed out for one connected account. */
export interface LinkRecord {
  readonly id: string
  readonly accountId: string
  readonly callbackUrl: string | null
  readonly expiresAt: string
  /** The PKCE verifier for the provider's code, once the link hands the user to a backend. */
  readonly verifier: string | null
}

/** A trigger set up on a connected account. */
export interface TriggerInstanceRecord {
  readonly id: string
  readonly uuid: string
  readonly triggerName: string
  readonly accountId: string
  readonly userId: string
  readonly config: Readonly<Record<string, unknown>>
  readonly version: string
  readonly disabledAt: string | null
  readonly createdAt: string
  readonly updatedAt: string
}

/** The project's one webhook subscription: where events go and the secret they are signed with. */
export interface WebhookSubscriptionRecord {
  readonly id: string
  readonly url: string
  readonly version: "V1" | "V2" | "V3"
  readonly events: readonly string[]
  readonly secret: string
  readonly createdAt: string
  readonly updatedAt: string
}

/** One tool execution, as the project's logs keep it. */
export interface ExecutionRecord {
  readonly id: string
  readonly tool: string
  readonly toolkit: string
  readonly userId: string | null
  readonly accountId: string | null
  readonly arguments: Readonly<Record<string, unknown>>
  readonly successful: boolean
  readonly error: string | null
  readonly data: unknown
  /** Which answered: a seeded result, the backend emulator, or the catalogue's sample. */
  readonly source: "seeded" | "backend" | "sample"
  readonly at: string
}
