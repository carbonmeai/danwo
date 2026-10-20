/**
 * Connections and their credentials: made when a connect session completes, renewed by a reconnect
 * session, refreshed when their access token expires, and announced with `auth` webhooks.
 */
import { randomBytes } from "node:crypto"

import type { Clock } from "../store.ts"
import { isoIn, NangoError, type NangoRouteContext } from "./helpers.ts"
import {
  connectionKey,
  type NangoConnection,
  type NangoCredentials,
  type NangoEndUser,
} from "./store.ts"

const HOUR = 3600_000

/** Fresh OAuth credentials, valid for an hour on the emulator's clock. */
function freshCredentials(clock: Clock, refreshToken?: string): NangoCredentials {
  const access = `ya29.danwo-${randomBytes(18).toString("base64url")}`
  const expiresAt = isoIn(clock, HOUR)

  return {
    type: "OAUTH2",
    access_token: access,
    refresh_token: refreshToken ?? `1//danwo-${randomBytes(18).toString("base64url")}`,
    expires_at: expiresAt,
    raw: { access_token: access, token_type: "Bearer", expires_in: 3600, scope: "" },
  }
}

/** The `auth` webhook the environment receives when a connection is made, renewed or fails to refresh. */
export function authWebhook(
  context: NangoRouteContext,
  connection: NangoConnection,
  operation: "creation" | "override" | "refresh",
  success: boolean,
): void {
  context.outbox.push("auth", {
    type: "auth",
    operation,
    success,
    connectionId: connection.connection_id,
    providerConfigKey: connection.provider_config_key,
    authMode: "OAUTH2",
    provider: connection.provider,
    environment: "dev",
    ...(connection.end_user && {
      endUser: {
        endUserId: connection.end_user.id,
        ...(connection.end_user.email && { endUserEmail: connection.end_user.email }),
      },
    }),
    tags: connection.tags,
    ...(!success && {
      error: {
        type: "refresh_token_external_error",
        description: "The provider refused the refresh token",
      },
    }),
  })
}

/** Makes (or renews) the connection of `integration` for `endUser`, as a completed session does. */
export function connect(
  context: NangoRouteContext,
  input: {
    readonly integration: string
    readonly connectionId?: string
    readonly endUser: NangoEndUser | null
    readonly tags?: Readonly<Record<string, string>>
  },
): { connection: NangoConnection; created: boolean } {
  const integration = context.objects.integrations.get(input.integration)

  if (!integration)
    throw new NangoError(
      404,
      "unknown_provider_config",
      `Integration ${input.integration} does not exist`,
    )

  const connectionId = input.connectionId ?? crypto.randomUUID()
  const key = connectionKey(integration.unique_key, connectionId)
  const now = context.clock().toISOString()
  const existing = context.objects.connections.get(key)

  if (existing) {
    const renewed = context.objects.connections.change(key, {
      credentials: freshCredentials(context.clock),
      broken: false,
      updated_at: now,
    })

    return { connection: renewed ?? existing, created: false }
  }

  const connection: NangoConnection = {
    id: key,
    numeric_id: context.objects.next(),
    connection_id: connectionId,
    provider_config_key: integration.unique_key,
    provider: integration.provider,
    created_at: now,
    updated_at: now,
    last_fetched_at: now,
    metadata: {},
    connection_config: {},
    end_user: input.endUser,
    tags: { ...input.tags },
    credentials: freshCredentials(context.clock),
    broken: false,
  }

  context.objects.connections.add(connection, null)

  return { connection, created: true }
}

/** The connection named by an integration key and a connection id. */
export function connectionOf(
  context: NangoRouteContext,
  integration: string | undefined,
  connectionId: string,
): NangoConnection {
  const found =
    integration === undefined
      ? context.objects.connections.where((c) => c.connection_id === connectionId)[0]
      : context.objects.connections.get(connectionKey(integration, connectionId))

  if (!found)
    throw new NangoError(404, "unknown_connection", `Connection ${connectionId} does not exist`)

  return found
}

/**
 * The connection with live credentials: an expired token (or a forced refresh) is refreshed, and a
 * broken one fails with Nango's refresh error and an `auth` webhook saying so.
 */
export function liveConnection(
  context: NangoRouteContext,
  connection: NangoConnection,
  force: boolean,
): NangoConnection {
  const expired = Date.parse(connection.credentials.expires_at) <= context.clock().getTime()

  if (!expired && !force) return touched(context, connection)

  if (connection.broken) {
    authWebhook(context, connection, "refresh", false)

    throw new NangoError(
      424,
      "refresh_token_external_error",
      "The external API returned an error when trying to refresh the access token. Please try again later.",
    )
  }

  const refreshed = context.objects.connections.change(connection.id, {
    credentials: freshCredentials(context.clock, connection.credentials.refresh_token),
  })

  return touched(context, refreshed ?? connection)
}

function touched(context: NangoRouteContext, connection: NangoConnection): NangoConnection {
  return (
    context.objects.connections.change(connection.id, {
      last_fetched_at: context.clock().toISOString(),
    }) ?? connection
  )
}

/** Who a connection belongs to, with every field Nango answers, unset ones as `null`. */
function endUserObject(endUser: NangoEndUser | null) {
  if (endUser === null) return null

  return {
    id: endUser.id,
    display_name: endUser.display_name ?? null,
    email: endUser.email ?? null,
    tags: endUser.tags ?? null,
    organization: null,
  }
}

/** A connection as `GET /connections/{id}` shows it; the refresh token only when asked for. */
export function connectionObject(connection: NangoConnection, withRefreshToken: boolean) {
  const { refresh_token: refreshToken, ...credentials } = connection.credentials

  return {
    id: connection.numeric_id,
    connection_id: connection.connection_id,
    provider_config_key: connection.provider_config_key,
    provider: connection.provider,
    errors: connection.broken ? [{ type: "auth", log_id: "danwo" }] : [],
    end_user: endUserObject(connection.end_user),
    metadata: connection.metadata,
    connection_config: connection.connection_config,
    created_at: connection.created_at,
    updated_at: connection.updated_at,
    last_fetched_at: connection.last_fetched_at,
    credentials: withRefreshToken ? { ...credentials, refresh_token: refreshToken } : credentials,
  }
}

/** A connection as `GET /connections` lists it: no credentials. */
export function listedConnection(connection: NangoConnection) {
  return {
    id: connection.numeric_id,
    connection_id: connection.connection_id,
    provider: connection.provider,
    provider_config_key: connection.provider_config_key,
    created: connection.created_at,
    metadata: connection.metadata,
    errors: connection.broken ? [{ type: "auth", log_id: "danwo" }] : [],
    end_user: endUserObject(connection.end_user),
    tags: connection.tags,
  }
}
