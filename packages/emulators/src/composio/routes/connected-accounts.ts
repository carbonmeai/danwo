import type {
  ConnectedAccountDeleteResponse,
  ConnectedAccountPatchResponse,
  ConnectedAccountRefreshResponse,
  ConnectedAccountUpdateStatusResponse,
  LinkCreateResponse,
} from "@composio/client/resources"

import type { Context } from "../../http.ts"
import { asRecord, isOneOf } from "../../json.ts"
import { accountOf, authConfigOf, changeAccount, newLink } from "../accounts.ts"
import { backendFor } from "../backends/index.ts"
import { startConnection } from "../connections.ts"
import type { ComposioRouteContext } from "../context.ts"
import { ACCOUNT_STATUSES, type ConnectedAccountRecord } from "../entities.ts"
import { connectedAccountObject } from "../formatters.ts"
import {
  api,
  badRequest,
  jsonBody,
  keeps,
  page,
  queryList,
  textOf,
  toolkitKey,
} from "../helpers.ts"

function wire(context: ComposioRouteContext, account: ConnectedAccountRecord) {
  return connectedAccountObject(account, context.objects.authConfigs.get(account.authConfigId))
}

/** The accounts a list request's filters keep, in the order it asks for. */
function listed(context: ComposioRouteContext, c: Context): ConnectedAccountRecord[] {
  const users = queryList(c, "user_ids")
  const configs = queryList(c, "auth_config_ids")
  const toolkits = queryList(c, "toolkit_slugs").map(toolkitKey)
  const statuses = queryList(c, "statuses")
  const ids = queryList(c, "connected_account_ids")
  const accounts = context.objects.accounts.where(
    (account) =>
      keeps(users, account.userId) &&
      keeps(configs, account.authConfigId) &&
      keeps(toolkits, account.toolkit) &&
      keeps(statuses, account.status) &&
      keeps(ids, account.id),
  )
  const field = c.req.query("order_by") === "updated_at" ? "updatedAt" : "createdAt"
  const sorted = accounts.toSorted((a, b) => a[field].localeCompare(b[field]))

  return c.req.query("order_direction") === "asc" ? sorted : sorted.toReversed()
}

/** Where the connection returns, its alias and given state, from the create body's `connection`. */
function connectionOptions(connection: Record<string, unknown>) {
  return {
    callbackUrl: textOf(connection["callback_url"]) ?? textOf(connection["redirect_uri"]) ?? null,
    alias: textOf(connection["alias"]) ?? null,
    state: connection["state"],
  }
}

/** `POST /connected_accounts`: connects with given credentials, or starts a hosted connection. */
async function create(context: ComposioRouteContext, c: Context): Promise<Response> {
  const body = await jsonBody(c)
  const configId = textOf(asRecord(body["auth_config"])?.["id"])
  const connection = asRecord(body["connection"]) ?? {}

  if (configId === undefined) throw badRequest("auth_config.id is required")

  const config = authConfigOf(context.objects, configId)
  const { account, link: hosted } = startConnection(
    context,
    config,
    textOf(connection["user_id"]) ?? "default",
    connectionOptions(connection),
  )
  const url = hosted?.url ?? null

  return c.json(
    {
      id: account.id,
      connectionData: {
        authScheme: config.authScheme,
        val: { ...account.val, status: account.status, ...(url && { redirectUrl: url }) },
      },
      status: account.status,
      redirect_url: url,
      redirect_uri: url,
      deprecated: { uuid: account.uuid, authConfigUuid: config.uuid },
    },
    201,
  )
}

/** `POST /connected_accounts/link`: a hosted link the user opens to connect. */
async function link(context: ComposioRouteContext, c: Context): Promise<Response> {
  const body = await jsonBody(c)
  const configId = textOf(body["auth_config_id"])
  const userId = textOf(body["user_id"])

  if (configId === undefined || userId === undefined)
    throw badRequest("auth_config_id and user_id are required")

  const config = authConfigOf(context.objects, configId)
  const started = startConnection(context, config, userId, {
    callbackUrl: textOf(body["callback_url"]) ?? null,
    alias: textOf(body["alias"]) ?? null,
  })
  const hosted =
    started.link ?? newLink(context, started.account, textOf(body["callback_url"]) ?? null)

  return c.json(
    {
      link_token: hosted.link.id,
      redirect_url: hosted.url,
      expires_at: hosted.link.expiresAt,
      connected_account_id: started.account.id,
    } satisfies LinkCreateResponse,
    201,
  )
}

/**
 * `POST /connected_accounts/{id}/refresh`: with a backend and a refresh token, new tokens and the
 * account ACTIVE again; otherwise a new hosted link to sign in again.
 */
async function refresh(context: ComposioRouteContext, c: Context): Promise<Response> {
  const account = accountOf(context.objects, c.req.param("id"))
  const body = await jsonBody(c)
  const callback = textOf(body["redirect_url"]) ?? textOf(c.req.query("redirect_url")) ?? null
  const connected = backendFor(context.store, account.toolkit)
  const refreshToken = account.val["refresh_token"]
  const renewed =
    connected && typeof refreshToken === "string"
      ? await connected.backend.refresh(
          (request) => connected.emulator.fetch(request),
          connected.backend.managedClient,
          refreshToken,
        )
      : undefined

  if (renewed) {
    changeAccount(context, account.id, {
      status: "ACTIVE",
      statusReason: null,
      val: { ...account.val, ...renewed },
    })

    return c.json({
      id: account.id,
      status: "ACTIVE",
      redirect_url: null,
    } satisfies ConnectedAccountRefreshResponse)
  }

  const { url } = newLink(context, account, callback)

  changeAccount(context, account.id, { status: "INITIATED", val: { redirectUrl: url } })

  return c.json({
    id: account.id,
    status: "INITIATED",
    redirect_url: url,
  } satisfies ConnectedAccountRefreshResponse)
}

/** Connected accounts: users' connections to toolkits. */
export function connectedAccountRoutes(context: ComposioRouteContext): void {
  const { objects } = context
  const routes = api(context.app)

  routes.post("/connected_accounts/link", (c) => link(context, c))
  routes.post("/connected_accounts", (c) => create(context, c))
  routes.get("/connected_accounts", (c) =>
    c.json(
      page(
        c,
        listed(context, c).map((account) => wire(context, account)),
      ),
    ),
  )
  routes.get("/connected_accounts/:id", (c) =>
    c.json(wire(context, accountOf(objects, c.req.param("id")))),
  )
  routes.patch("/connected_accounts/:id/status", async (c) => {
    const account = accountOf(objects, c.req.param("id"))
    const enabled = (await jsonBody(c))["enabled"] === true

    changeAccount(context, account.id, { disabled: !enabled })

    return c.json({ success: true } satisfies ConnectedAccountUpdateStatusResponse)
  })
  routes.patch("/connected_accounts/:id", async (c) => {
    const account = accountOf(objects, c.req.param("id"))
    const body = await jsonBody(c)
    const status = body["status"]
    const alias = textOf(body["alias"])
    const changed = changeAccount(context, account.id, {
      ...(alias !== undefined && { alias }),
      ...(typeof body["enabled"] === "boolean" && { disabled: !body["enabled"] }),
      ...(isOneOf(ACCOUNT_STATUSES, status) && { status }),
    })

    return c.json({
      success: true,
      id: changed.id,
      status: changed.status,
    } satisfies ConnectedAccountPatchResponse)
  })
  routes.post("/connected_accounts/:id/refresh", (c) => refresh(context, c))
  routes.delete("/connected_accounts/:id", (c) => {
    const account = accountOf(objects, c.req.param("id"))

    objects.accounts.remove(account.id)
    for (const trigger of objects.triggers.where((t) => t.accountId === account.id))
      objects.triggers.remove(trigger.id)

    return c.json({ success: true } satisfies ConnectedAccountDeleteResponse)
  })
}
