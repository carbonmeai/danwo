/** Nango's API: integrations, connect sessions, connections, the proxy, actions and records. */
import { randomBytes } from "node:crypto"

import type { Context } from "../../http.ts"
import { asRecord } from "../../json.ts"
import { backendFor } from "../backends.ts"
import { connectionObject, connectionOf, listedConnection, liveConnection } from "../connections.ts"
import {
  CONNECT_ORIGIN,
  isoIn,
  NangoError,
  type NangoRouteContext,
  requireSecret,
} from "../helpers.ts"
import type { NangoConnection, NangoEndUser, NangoSession } from "../store.ts"

const SESSION_MS = 30 * 60_000

async function bodyOf(c: Context): Promise<Record<string, unknown>> {
  try {
    return asRecord(await c.req.json()) ?? {}
  } catch {
    return {}
  }
}

/** The end user a session body names; Nango needs at least an id. */
function endUserOf(value: unknown): NangoEndUser | null {
  const user = asRecord(value)
  const id = user?.["id"]

  if (typeof id !== "string") return null

  return {
    id,
    ...(typeof user?.["email"] === "string" && { email: user["email"] }),
    ...(typeof user?.["display_name"] === "string" && { display_name: user["display_name"] }),
  }
}

const strings = (value: unknown): Record<string, string> =>
  Object.fromEntries(
    Object.entries(asRecord(value) ?? {}).flatMap(([k, v]) =>
      typeof v === "string" ? [[k, v]] : [],
    ),
  )

function newSession(
  context: NangoRouteContext,
  body: Readonly<Record<string, unknown>>,
  reconnect: NangoSession["reconnect"],
): NangoSession {
  const allowed = Array.isArray(body["allowed_integrations"])
    ? body["allowed_integrations"].filter((i): i is string => typeof i === "string")
    : null
  const session: NangoSession = {
    id: `nango_connect_session_${randomBytes(24).toString("hex")}`,
    end_user: endUserOf(body["end_user"]),
    organization: asRecord(body["organization"]) ?? null,
    allowed_integrations: reconnect ? [reconnect.integration_id] : allowed,
    tags: strings(body["tags"]),
    expires_at: isoIn(context.clock, SESSION_MS),
    reconnect,
  }

  return context.objects.sessions.add(session, null)
}

const sessionAnswer = (session: NangoSession) => ({
  data: {
    token: session.id,
    connect_link: `${CONNECT_ORIGIN}/?session_token=${session.id}`,
    expires_at: session.expires_at,
  },
})

function sessionRoutes(context: NangoRouteContext): void {
  const { app } = context

  app.post("/connect/sessions", async (c) => {
    requireSecret(context, c)

    const body = await bodyOf(c)

    if (endUserOf(body["end_user"]) === null && body["tags"] === undefined)
      throw new NangoError(400, "invalid_body", "end_user.id or tags is required")

    return c.json(sessionAnswer(newSession(context, body, null)), 201)
  })
  app.post("/connect/sessions/reconnect", async (c) => {
    requireSecret(context, c)

    const body = await bodyOf(c)
    const connectionId = body["connection_id"]
    const integration = body["integration_id"]

    if (typeof connectionId !== "string" || typeof integration !== "string")
      throw new NangoError(400, "invalid_body", "connection_id and integration_id are required")

    connectionOf(context, integration, connectionId)

    return c.json(
      sessionAnswer(
        newSession(context, body, { connection_id: connectionId, integration_id: integration }),
      ),
      201,
    )
  })
}

function integrationRoutes(context: NangoRouteContext): void {
  const { app, objects } = context
  /** An integration as Nango lists one: webhooks forwarded, and no settings left to fill in. */
  const shown = ({
    id: _id,
    ...integration
  }: ReturnType<typeof objects.integrations.all>[number]) => ({
    ...integration,
    forward_webhooks: true,
    missing_fields: [],
  })

  app.get("/integrations", (c) => {
    requireSecret(context, c)

    return c.json({ data: objects.integrations.all().map(shown) })
  })
  app.get("/integrations/:key", (c) => {
    requireSecret(context, c)

    const integration = objects.integrations.get(c.req.param("key"))

    if (!integration)
      throw new NangoError(404, "not_found", `Integration ${c.req.param("key")} does not exist`)

    return c.json({ data: shown(integration) })
  })
}

/** Whether a connection matches a list call's filters. */
function listedBy(c: Context): (connection: NangoConnection) => boolean {
  const id = c.req.query("connectionId")
  const endUser = c.req.query("endUserId")
  const integrations = c.req.query("integrationId")?.split(",")

  return (connection) =>
    (id === undefined || connection.connection_id === id) &&
    (endUser === undefined || connection.end_user?.id === endUser) &&
    (integrations === undefined || integrations.includes(connection.provider_config_key))
}

function connectionRoutes(context: NangoRouteContext): void {
  const { app, objects } = context

  const list = (c: Context) => {
    requireSecret(context, c)

    return c.json({ connections: objects.connections.where(listedBy(c)).map(listedConnection) })
  }

  const get = (c: Context) => {
    requireSecret(context, c)

    const connection = connectionOf(context, c.req.query("provider_config_key"), c.req.param("id"))
    const live = liveConnection(context, connection, c.req.query("force_refresh") === "true")

    return c.json(connectionObject(live, c.req.query("refresh_token") === "true"))
  }

  const remove = (c: Context) => {
    requireSecret(context, c)

    const connection = connectionOf(context, c.req.query("provider_config_key"), c.req.param("id"))

    objects.connections.remove(connection.id)

    return c.body(null, 204)
  }

  const patch = async (c: Context) => {
    requireSecret(context, c)

    const connection = connectionOf(context, c.req.query("provider_config_key"), c.req.param("id"))
    const body = await bodyOf(c)
    const changed = objects.connections.change(connection.id, {
      ...(body["tags"] !== undefined && { tags: strings(body["tags"]) }),
      ...(body["end_user"] !== undefined && { end_user: endUserOf(body["end_user"]) }),
      updated_at: context.clock().toISOString(),
    })

    return c.json(listedConnection(changed ?? connection))
  }

  for (const base of ["/connections", "/connection"]) {
    app.get(base, list)
    app.get(`${base}/:id`, get)
    app.delete(`${base}/:id`, remove)
    app.patch(`${base}/:id`, patch)
  }

  const metadata = async (c: Context, merge: boolean) => {
    requireSecret(context, c)

    const body = await bodyOf(c)
    const ids = Array.isArray(body["connection_id"])
      ? body["connection_id"]
      : [body["connection_id"]]
    const integration =
      typeof body["provider_config_key"] === "string" ? body["provider_config_key"] : undefined
    const data = asRecord(body["metadata"]) ?? {}

    for (const id of ids.filter((i): i is string => typeof i === "string")) {
      const connection = connectionOf(context, integration, id)

      objects.connections.change(connection.id, {
        metadata: merge ? { ...connection.metadata, ...data } : data,
      })
    }

    return c.json({ success: true })
  }

  app.post("/connection/metadata", (c) => metadata(c, false))
  app.patch("/connection/metadata", (c) => metadata(c, true))
}

/** The connection a proxy, action or records call names in its headers, with live credentials. */
function headerConnection(context: NangoRouteContext, c: Context): NangoConnection {
  requireSecret(context, c)

  const id = c.req.header("connection-id")
  const integration = c.req.header("provider-config-key")

  if (id === undefined || integration === undefined)
    throw new NangoError(
      400,
      "missing_connection_id",
      "Connection-Id and Provider-Config-Key headers are required",
    )

  return liveConnection(context, connectionOf(context, integration, id), false)
}

/** What a seeded answer says to a proxied call, if one matches. */
function seededAnswer(
  context: NangoRouteContext,
  connection: NangoConnection,
  method: string,
  path: string,
) {
  return context.objects.answers
    .all()
    .find(
      (answer) =>
        (answer.integration === undefined ||
          answer.integration === connection.provider_config_key) &&
        (answer.method === undefined || answer.method.toUpperCase() === method) &&
        (answer.path.endsWith("*")
          ? path.startsWith(answer.path.slice(0, -1))
          : answer.path === path),
    )
}

/** One proxied call as the proxy received it. */
interface ProxiedCall {
  readonly connection: NangoConnection
  readonly method: string
  readonly path: string
  readonly search: string
  readonly body: string | undefined
  readonly contentType: string
}

async function proxied(context: NangoRouteContext, c: Context): Promise<Response> {
  const url = new URL(c.req.url)
  const raw = ["GET", "HEAD"].includes(c.req.method) ? "" : await c.req.text()
  const call: ProxiedCall = {
    connection: headerConnection(context, c),
    method: c.req.method,
    path: url.pathname.replace(/^\/proxy/, "") || "/",
    search: url.search,
    body: raw === "" ? undefined : raw,
    contentType: c.req.header("content-type") ?? "application/json",
  }
  const answer = await answerFor(context, call)

  recordProxied(context, call, answer.status)

  return answer
}

/** The backend emulator's answer to a proxied call, or the seeded one (an empty 200 when none matches). */
async function answerFor(context: NangoRouteContext, call: ProxiedCall): Promise<Response> {
  const backend = backendFor(context.store, call.connection.provider)

  if (backend)
    return backend.emulator.fetch(
      new Request(`${backend.base}${call.path}${call.search}`, {
        method: call.method,
        headers: {
          authorization: `Bearer ${call.connection.credentials.access_token}`,
          "content-type": call.contentType,
        },
        ...(call.body !== undefined && { body: call.body }),
      }),
    )

  const seeded = seededAnswer(context, call.connection, call.method, call.path)

  return Response.json(seeded?.body ?? {}, { status: seeded?.status ?? 200 })
}

function recordProxied(context: NangoRouteContext, call: ProxiedCall, status: number): void {
  context.objects.calls.add(
    {
      id: `call_${context.objects.next()}`,
      kind: "proxy",
      connection_id: call.connection.connection_id,
      integration: call.connection.provider_config_key,
      method: call.method,
      path: `${call.path}${call.search}`,
      body: call.body ?? null,
      status,
    },
    null,
  )
}

function proxyRoutes(context: NangoRouteContext): void {
  const { app, objects } = context

  /* Proxied paths have any depth, so they are caught before the routes, which match fixed shapes. */
  app.use((c, next) => (c.req.path.startsWith("/proxy/") ? proxied(context, c) : next()))

  app.post("/action/trigger", async (c) => {
    const connection = headerConnection(context, c)
    const body = await bodyOf(c)
    const name = typeof body["action_name"] === "string" ? body["action_name"] : ""
    const action = objects.actions
      .all()
      .find((a) => a.integration === connection.provider_config_key && a.name === name)

    objects.calls.add(
      {
        id: `call_${objects.next()}`,
        kind: "action",
        connection_id: connection.connection_id,
        integration: connection.provider_config_key,
        method: "POST",
        path: name,
        body: body["input"] ?? null,
        status: action ? 200 : 404,
      },
      null,
    )

    if (!action)
      throw new NangoError(
        404,
        "unknown_action",
        `Action ${name} is not deployed for ${connection.provider_config_key}`,
      )

    return c.json(action.output)
  })
  app.get("/records", (c) => {
    const connection = headerConnection(context, c)
    const model = c.req.query("model")
    const found = objects.records
      .all()
      .find((r) => r.connection_id === connection.connection_id && r.model === model)

    return c.json({ records: found?.records ?? [], next_cursor: null })
  })
}

/** Every API route. */
export function apiRoutes(context: NangoRouteContext): void {
  for (const register of [sessionRoutes, integrationRoutes, connectionRoutes, proxyRoutes])
    register(context)
}
