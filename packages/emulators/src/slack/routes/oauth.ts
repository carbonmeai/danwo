import type { OauthV2AccessResponse } from "@slack/web-api"

import type { Context } from "../../http.ts"
import { renderChooser, renderProblem } from "../../oauth/sign-in-page.ts"
import { apiError, readArgs } from "../api.ts"
import type { ApiCall, Methods, SlackRouteContext } from "../context.ts"
import type { AppRecord, InstallCode, TokenRecord } from "../entities.ts"
import { type Args, flagArg, HOOKS_BASE, SlackApiError, secretHex, stringArg } from "../helpers.ts"
import {
  type Grant,
  installApp,
  issueToken,
  ROTATING_TOKEN_SECONDS,
  uninstallApp,
} from "../install.ts"
import { teamOf } from "../lookup.ts"

/** How long an install code stays good: ten minutes. */
const CODE_MS = 10 * 60_000

/** A scope list from a URL: Slack takes commas, and spaces too. */
const scopesOf = (value: string | null) =>
  (value ?? "").split(/[\s,]+/).filter((scope) => scope !== "")

/** Whether `uri` is one of the app's redirect URLs, or a path under one, as Slack allows. */
function allowedRedirect(app: AppRecord, uri: string): boolean {
  return app.redirectUrls.some(
    (allowed) => uri === allowed || uri.startsWith(`${allowed.replace(/\/$/, "")}/`),
  )
}

/** The consent page: who installs the app into the workspace, or Cancel. */
function authorize(c: Context, context: SlackRouteContext): Response {
  const { slack } = context
  const url = new URL(c.req.url)
  const app = slack.apps.findOneBy("clientId", url.searchParams.get("client_id") ?? "")

  if (!app) return c.html(renderProblem("Oops! Something went wrong.", "invalid_client_id"), 400)

  const redirectUri = url.searchParams.get("redirect_uri") ?? app.redirectUrls[0] ?? ""

  if (!allowedRedirect(app, redirectUri))
    return c.html(renderProblem("Oops! Something went wrong.", "bad_redirect_uri"), 400)

  const botScopes = scopesOf(url.searchParams.get("scope"))
  const userScopes = scopesOf(url.searchParams.get("user_scope"))

  if (botScopes.length === 0 && userScopes.length === 0)
    return c.html(renderProblem("Oops! Something went wrong.", "invalid_scope"), 400)

  const request = slack.pending.insert({
    requestId: `req_${secretHex(9)}`,
    appId: app.appId,
    botScopes,
    userScopes,
    redirectUri,
    state: url.searchParams.get("state"),
  })
  const team = teamOf(slack)
  const members = slack.users.all().filter((user) => !user.isBot && !user.deleted)

  return c.html(
    renderChooser({
      title: `${app.name} is requesting permission to access the ${team.name} Slack workspace`,
      subtitle: `It will be able to: ${[...botScopes, ...userScopes].join(", ")}`,
      action: "/oauth/v2/authorize",
      requestId: request.requestId,
      accounts: members.map((user) => ({
        id: user.userId,
        name: user.realName,
        email: user.email ?? user.name,
      })),
    }),
  )
}

/** Sends the browser back to the app with `fields` in the query. */
function backToApp(
  c: Context,
  redirectUri: string,
  state: string | null,
  fields: Record<string, string>,
) {
  const target = new URL(redirectUri)

  for (const [name, value] of Object.entries({ ...fields, ...(state !== null && { state }) }))
    target.searchParams.set(name, value)

  return c.redirect(target.toString(), 302)
}

/** The consent page's answer: a code for the chosen installer, or `access_denied`. */
async function consent(c: Context, context: SlackRouteContext): Promise<Response> {
  const { slack, clock } = context
  const form = new URLSearchParams(await c.req.text())
  const pending = slack.pending.findOneBy("requestId", form.get("request") ?? "")

  if (!pending)
    return c.html(
      renderProblem("This link has expired", "Start the install again from the app."),
      400,
    )
  slack.pending.delete(pending.id)
  if (form.has("deny"))
    return backToApp(c, pending.redirectUri, pending.state, { error: "access_denied" })

  const installer = slack.users.findOneBy("userId", form.get("user") ?? "")

  if (!installer || installer.isBot)
    return c.html(
      renderProblem("Account unavailable", "That member cannot install apps here."),
      400,
    )

  const code = slack.codes.insert({
    code: `${clock().getTime()}.${secretHex(16)}`,
    appId: pending.appId,
    installer: installer.userId,
    botScopes: pending.botScopes,
    userScopes: pending.userScopes,
    redirectUri: pending.redirectUri,
    expiresAt: clock().getTime() + CODE_MS,
  })

  return backToApp(c, pending.redirectUri, pending.state, { code: code.code })
}

/** The app a token request authenticates as: `client_id` and `client_secret`, or HTTP Basic. */
function clientOf(c: Context, context: SlackRouteContext, args: Args): AppRecord {
  const basic = /^Basic\s+(\S+)$/i.exec(c.req.header("authorization") ?? "")?.[1]
  const [basicId, basicSecret] = Buffer.from(basic ?? "", "base64")
    .toString()
    .split(":")
  const app = context.slack.apps.findOneBy(
    "clientId",
    stringArg(args, "client_id") ?? basicId ?? "",
  )

  if (!app) throw new SlackApiError("invalid_client_id")
  if ((stringArg(args, "client_secret") ?? basicSecret) !== app.clientSecret)
    throw new SlackApiError("bad_client_secret")

  return app
}

/** A code the app may exchange: issued to it, not used, not expired, same redirect URI. */
function redeemCode(context: SlackRouteContext, app: AppRecord, args: Args): InstallCode {
  const { slack, clock } = context
  const code = slack.codes.findOneBy("code", stringArg(args, "code") ?? "")

  if (!code || code.appId !== app.appId || code.expiresAt < clock().getTime())
    throw new SlackApiError("invalid_code")

  const redirectUri = stringArg(args, "redirect_uri")

  if (redirectUri !== undefined && redirectUri !== code.redirectUri)
    throw new SlackApiError("bad_redirect_uri")
  slack.codes.delete(code.id)

  return code
}

/** The fields of a token in an `oauth.v2.access` answer, with its expiry when it rotates. */
function tokenFields(token: TokenRecord) {
  return {
    access_token: token.token,
    token_type: token.kind,
    scope: token.scopes.join(","),
    ...(token.refreshToken !== null && {
      refresh_token: token.refreshToken,
      expires_in: ROTATING_TOKEN_SECONDS,
    }),
  }
}

/** The `oauth.v2.access` answer for a new install. */
function installAnswer(context: SlackRouteContext, app: AppRecord, grant: Grant) {
  const team = teamOf(context.slack)
  const user = grant.user

  return {
    ok: true,
    app_id: app.appId,
    ...(grant.bot ? tokenFields(grant.bot) : {}),
    bot_user_id: grant.install.botUserId,
    team: { id: team.teamId, name: team.name },
    is_enterprise_install: false,
    authed_user: {
      id: grant.install.installer,
      ...(user ? tokenFields(user) : {}),
    },
    ...(grant.webhook && {
      incoming_webhook: {
        channel: `#${context.slack.channels.findOneBy("channelId", grant.webhook.channel)?.name ?? ""}`,
        channel_id: grant.webhook.channel,
        configuration_url: `https://${team.domain}.slack.com/services/${grant.webhook.path.split("/")[3] ?? ""}`,
        url: `${HOOKS_BASE}${grant.webhook.path}`,
      },
    }),
  } satisfies OauthV2AccessResponse
}

/** A refresh: the old refresh token is spent, a new access and refresh token pair is issued. */
function refresh(context: SlackRouteContext, app: AppRecord, args: Args) {
  const { slack, clock } = context
  const old = slack.tokens.findOneBy("refreshToken", stringArg(args, "refresh_token") ?? "")

  if (!old || old.appId !== app.appId) throw new SlackApiError("invalid_refresh_token")
  slack.tokens.update(old.id, { refreshToken: null, revoked: true })

  const grant = { kind: old.kind, appId: old.appId, teamId: old.teamId, userId: old.userId }
  const token = issueToken(slack, { ...grant, scopes: old.scopes }, true, clock)
  const team = teamOf(slack)

  return {
    ok: true,
    app_id: app.appId,
    ...tokenFields(token),
    ...(token.kind === "bot" && { bot_user_id: token.userId }),
    team: { id: team.teamId, name: team.name },
    is_enterprise_install: false,
  } satisfies OauthV2AccessResponse
}

/** `oauth.v2.access`: exchanges an install code, or with `grant_type=refresh_token`, a refresh token. */
async function access(c: Context, context: SlackRouteContext): Promise<Response> {
  const args = await readArgs(c)

  try {
    const app = clientOf(c, context, args)

    if (stringArg(args, "grant_type") === "refresh_token")
      return c.json(refresh(context, app, args))

    const code = redeemCode(context, app, args)
    const grant = installApp(context.slack, context.clock, {
      app,
      installer: code.installer,
      botScopes: code.botScopes,
      userScopes: code.userScopes,
    })

    return c.json(installAnswer(context, app, grant))
  } catch (error) {
    if (error instanceof SlackApiError) return apiError(c, error)

    throw error
  }
}

function authTest(call: ApiCall) {
  const { slack } = call.context
  const team = teamOf(slack)
  const user = slack.users.findOneBy("userId", call.token.userId)

  return {
    url: `https://${team.domain}.slack.com/`,
    team: team.name,
    user: user?.name ?? "",
    team_id: team.teamId,
    user_id: call.token.userId,
    is_enterprise_install: false,
    ...(user?.botId && { bot_id: user.botId, app_id: call.token.appId }),
  }
}

function authRevoke(call: ApiCall) {
  const { slack, events } = call.context
  const token = call.token

  if (flagArg(call.args, "test")) return { revoked: false }
  slack.tokens.update(token.id, { revoked: true })
  events.tokensRevoked(token.appId, {
    oauth: token.kind === "user" ? [token.userId] : [],
    bot: token.kind === "bot" ? [token.userId] : [],
  })

  return { revoked: true }
}

/**
 * `apps.uninstall`: the app removes itself with a user token from its install and its own client
 * id and secret. A bot token may not.
 */
function appsUninstall(call: ApiCall) {
  const { slack, events } = call.context
  const app = slack.apps.findOneBy("clientId", stringArg(call.args, "client_id") ?? "")

  if (call.token.kind !== "user") throw new SlackApiError("no_permission")
  if (!app || app.appId !== call.token.appId) throw new SlackApiError("invalid_client_id")
  if (stringArg(call.args, "client_secret") !== app.clientSecret)
    throw new SlackApiError("bad_client_secret")
  uninstallApp(slack, events, app.appId)

  return {}
}

/** The consent page and the token endpoint, on `slack.com`. */
export function oauthRoutes(context: SlackRouteContext): void {
  context.app.get("/oauth/v2/authorize", (c) => authorize(c, context))
  context.app.post("/oauth/v2/authorize", (c) => consent(c, context))
  context.app.post("/api/oauth.v2.access", (c) => access(c, context))
}

/** `auth.test`, `auth.revoke` and `apps.uninstall`. */
export const authMethods: Methods = {
  "auth.test": { scopes: [], run: authTest },
  "auth.revoke": { scopes: [], run: authRevoke },
  "apps.uninstall": { scopes: [], run: appsUninstall },
}
