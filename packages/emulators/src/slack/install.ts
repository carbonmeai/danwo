import { randomInt } from "node:crypto"

import type { Clock } from "../store.ts"
import type {
  AppRecord,
  IncomingWebhookRecord,
  InstallationRecord,
  TokenKind,
  TokenRecord,
} from "./entities.ts"
import { secretHex, SlackApiError, slackId } from "./helpers.ts"
import { findChannel, teamOf } from "./lookup.ts"
import type { SlackStore } from "./store.ts"

/** How long a rotating access token lives: twelve hours. */
export const ROTATING_TOKEN_SECONDS = 43_200

const digits = (length: number) =>
  Array.from({ length }, (_, index) => randomInt(index === 0 ? 1 : 0, 10)).join("")

/** A token string in Slack's shape: `xoxb-…` for bots, `xoxp-…` for users, `xoxe.` when rotating. */
function tokenString(kind: TokenKind, rotating: boolean): string {
  const prefix = kind === "bot" ? "xoxb" : "xoxp"
  const body = `${digits(13)}-${digits(13)}-${secretHex(12)}`

  return rotating ? `xoxe.${prefix}-1-${body}` : `${prefix}-${body}`
}

/** What a new token is for. */
export interface TokenGrant {
  readonly kind: TokenKind
  readonly appId: string
  readonly teamId: string
  readonly userId: string
  readonly scopes: readonly string[]
}

/** Issues a token; with rotation on, a twelve-hour one with its refresh token. */
export function issueToken(
  slack: SlackStore,
  grant: TokenGrant,
  rotating: boolean,
  clock: Clock,
  value?: string,
): TokenRecord {
  return slack.tokens.insert({
    ...grant,
    scopes: [...grant.scopes],
    token: value ?? tokenString(grant.kind, rotating),
    expiresAt: rotating ? clock().getTime() + ROTATING_TOKEN_SECONDS * 1000 : null,
    refreshToken: rotating ? `xoxe-1-${secretHex(32)}` : null,
    revoked: false,
  })
}

/** The live token of `kind` an app holds for `userId`, if any. */
function liveToken(slack: SlackStore, appId: string, kind: TokenKind, userId: string) {
  return slack.tokens
    .findBy("appId", appId)
    .find((token) => token.kind === kind && token.userId === userId && !token.revoked)
}

/** The scopes granted so far plus the new ones: Slack's grants add up across installs. */
const union = (a: readonly string[], b: readonly string[]) => [...new Set([...a, ...b])]

/** The bot user an app posts as, created the first time the app is installed. */
function botUserFor(slack: SlackStore, app: AppRecord): { userId: string; botId: string } {
  const existing = slack.users.all().find((user) => user.appId === app.appId && user.isBot)

  if (existing?.botId) return { userId: existing.userId, botId: existing.botId }

  const botId = slackId("B")
  const user = slack.users.insert({
    userId: slackId("U"),
    name: app.name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    realName: app.name,
    email: null,
    isAdmin: false,
    isBot: true,
    botId,
    appId: app.appId,
    deleted: false,
  })

  return { userId: user.userId, botId }
}

/** What installing an app asked for. */
export interface InstallRequest {
  readonly app: AppRecord
  readonly installer: string
  readonly botScopes: readonly string[]
  readonly userScopes: readonly string[]
  /** For the `incoming-webhook` scope: the channel the webhook posts to. */
  readonly webhookChannel?: string | undefined
  /** Fixed token strings, for tests that skip the consent page. */
  readonly botToken?: string | undefined
  readonly userToken?: string | undefined
}

/** What an install granted. */
export interface Grant {
  readonly install: InstallationRecord
  readonly bot: TokenRecord | null
  readonly user: TokenRecord | null
  readonly webhook: IncomingWebhookRecord | null
}

/** Records the installation, adding to any earlier grant. */
function recordInstall(slack: SlackStore, request: InstallRequest): InstallationRecord {
  const { app } = request
  const team = teamOf(slack).teamId
  const existing = slack.installations.findOneBy("appId", app.appId)
  const fields = {
    installer: request.installer,
    botScopes: union(existing?.botScopes ?? [], request.botScopes),
    userScopes: union(existing?.userScopes ?? [], request.userScopes),
  }

  if (existing) return slack.installations.update(existing.id, fields) ?? existing

  const bot = botUserFor(slack, app)

  return slack.installations.insert({
    appId: app.appId,
    teamId: team,
    botUserId: bot.userId,
    botId: bot.botId,
    webhookChannel: null,
    ...fields,
  })
}

/** A token of `kind` with `scopes`, reusing the live one and widening its scopes. */
function tokenFor(
  slack: SlackStore,
  clock: Clock,
  grant: TokenGrant,
  rotating: boolean,
  value: string | undefined,
): TokenRecord {
  const live = liveToken(slack, grant.appId, grant.kind, grant.userId)

  if (live) return slack.tokens.update(live.id, { scopes: [...grant.scopes] }) ?? live

  return issueToken(slack, grant, rotating, clock, value)
}

/**
 * An incoming webhook into `channel`, for an install with the `incoming-webhook` scope. Choosing
 * the channel adds the app's bot user to it, as installing does on Slack.
 */
function webhookFor(slack: SlackStore, install: InstallationRecord, channel: string | undefined) {
  const target = findChannel(slack, channel ?? "general") ?? slack.channels.all()[0]

  if (!target) throw new SlackApiError("channel_not_found")
  if (!target.members.includes(install.botUserId))
    slack.channels.update(target.id, { members: [...target.members, install.botUserId] })

  return slack.webhooks.insert({
    path: `/services/${install.teamId}/${slackId("B")}/${secretHex(12)}`,
    appId: install.appId,
    channel: target.channelId,
  })
}

/** Installs an app for `installer`: its bot user, a bot token, a user token if asked, a webhook if asked. */
export function installApp(slack: SlackStore, clock: Clock, request: InstallRequest): Grant {
  const { app } = request
  const install = recordInstall(slack, request)
  const base = { appId: app.appId, teamId: install.teamId }
  const bot =
    install.botScopes.length === 0
      ? null
      : tokenFor(
          slack,
          clock,
          { ...base, kind: "bot", userId: install.botUserId, scopes: install.botScopes },
          app.tokenRotation,
          request.botToken,
        )
  const user =
    request.userScopes.length === 0
      ? null
      : tokenFor(
          slack,
          clock,
          { ...base, kind: "user", userId: request.installer, scopes: request.userScopes },
          app.tokenRotation,
          request.userToken,
        )
  const webhook = request.botScopes.includes("incoming-webhook")
    ? webhookFor(slack, install, request.webhookChannel)
    : null

  return { install, bot, user, webhook }
}
