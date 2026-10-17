import type { Store } from "../store.ts"
import type { AppRecord, UserRecord } from "./entities.ts"
import { secretHex, slackId } from "./helpers.ts"
import { installApp } from "./install.ts"
import { findChannel, findUser, teamOf } from "./lookup.ts"
import { type SlackStore, slackStore } from "./store.ts"

type Names = readonly string[]

/** A member to seed; `name` is their handle. */
export type SlackSeedUser = { readonly name: string } & Partial<
  Readonly<Record<"email" | "real_name", string> & { is_admin: boolean }>
>

/** A channel to seed, with its members by id, email or handle. `#general` always exists. */
export type SlackSeedChannel = { readonly name: string } & Partial<
  Readonly<Record<"topic" | "purpose", string> & { is_private: boolean; members: Names }>
>

/**
 * An app as its configuration page holds it: credentials, scopes, the Events API request URL with
 * the bot events it subscribes to, the interactivity URL and slash commands. `token_rotation`
 * gives short-lived tokens with refresh tokens.
 */
export type SlackSeedApp = Readonly<
  Record<"name" | "client_id" | "client_secret" | "signing_secret", string>
> &
  Partial<
    Readonly<
      Record<"app_id" | "verification_token" | "interactivity_url", string> &
        Record<"redirect_urls" | "bot_scopes" | "user_scopes", Names> & {
          events: { readonly url: string; readonly bot_events: Names }
          commands: readonly Readonly<Record<"command" | "url", string>>[]
          token_rotation: boolean
        }
    >
  >

/**
 * An app already installed, so a test can call the API without the consent page. `app` is its
 * client id, app id or name; `installer` a member (the first one when absent); the tokens are fixed
 * strings to configure the app under test with; `webhook_channel` is where an `incoming-webhook`
 * install posts; `channels` are those its bot user is in.
 */
export type SlackSeedInstall = { readonly app: string } & Partial<
  Readonly<
    Record<"installer" | "bot_token" | "user_token" | "webhook_channel", string> & {
      channels: Names
    }
  >
>

/** A workspace to load into a Slack emulator. */
export type SlackSeedConfig = Partial<{
  readonly team: { readonly name: string } & Partial<Readonly<Record<"id" | "domain", string>>>
  readonly users: readonly SlackSeedUser[]
  readonly channels: readonly SlackSeedChannel[]
  readonly apps: readonly SlackSeedApp[]
  readonly installations: readonly SlackSeedInstall[]
}>

/** Names the workspace as the seed asks. */
function seedTeam(slack: SlackStore, team: SlackSeedConfig["team"]): void {
  if (team === undefined) return

  slack.teams.update(teamOf(slack).id, {
    ...(team.id !== undefined && { teamId: team.id }),
    name: team.name,
    domain: team.domain ?? team.name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
  })
}

function seedUser(slack: SlackStore, user: SlackSeedUser): UserRecord {
  return slack.users.insert({
    userId: slackId("U"),
    name: user.name,
    realName: user.real_name ?? user.name,
    email: user.email ?? null,
    isAdmin: user.is_admin ?? false,
    isBot: false,
    botId: null,
    appId: null,
    deleted: false,
  })
}

/** Member ids for `keys`, skipping names nobody has. */
function memberIds(slack: SlackStore, keys: readonly string[]): string[] {
  return keys.flatMap((key) => {
    const user = findUser(slack, key)

    return user ? [user.userId] : []
  })
}

function seedChannel(slack: SlackStore, channel: SlackSeedChannel, creator: string): void {
  slack.channels.insert({
    channelId: slackId("C"),
    name: channel.name.replace(/^#/, ""),
    kind: channel.is_private ? "group" : "channel",
    creator,
    members: memberIds(slack, channel.members ?? []),
    topic: channel.topic ?? "",
    purpose: channel.purpose ?? "",
    archived: false,
  })
}

/** `#general`, with every member in it, unless the seed made it already. */
function ensureGeneral(slack: SlackStore, creator: string): void {
  if (findChannel(slack, "general")) return

  const everyone = slack.users
    .all()
    .filter((user) => !user.isBot)
    .map((user) => user.name)

  seedChannel(slack, { name: "general", members: everyone }, creator)
}

/** An app's identity and credentials. */
function credentialsOf(app: SlackSeedApp) {
  return {
    appId: app.app_id ?? slackId("A"),
    name: app.name,
    clientId: app.client_id,
    clientSecret: app.client_secret,
    signingSecret: app.signing_secret,
    verificationToken: app.verification_token ?? secretHex(12),
    tokenRotation: app.token_rotation ?? false,
  }
}

/** Where an app is reached: install redirects, events, interactions and commands. */
function deliveryOf(app: SlackSeedApp) {
  const events = app.events ?? { url: null, bot_events: [] }

  return {
    redirectUrls: [...(app.redirect_urls ?? [])],
    eventsUrl: events.url,
    botEvents: [...events.bot_events],
    interactivityUrl: app.interactivity_url ?? null,
    commands: (app.commands ?? []).map((setting) => ({ ...setting })),
  }
}

function seedApp(slack: SlackStore, app: SlackSeedApp): void {
  slack.apps.insert({
    ...credentialsOf(app),
    ...deliveryOf(app),
    botScopes: [...(app.bot_scopes ?? [])],
    userScopes: [...(app.user_scopes ?? [])],
  })
}

function appByKey(slack: SlackStore, key: string): AppRecord {
  const app = slack.apps.all().find((a) => [a.clientId, a.appId, a.name].includes(key))

  if (!app) throw new Error(`no Slack app "${key}" to install: seed it under apps`)

  return app
}

/** Adds `user` to each named channel it is not in yet. */
function joinChannels(slack: SlackStore, user: string, keys: readonly string[]): void {
  for (const key of keys) {
    const channel = findChannel(slack, key)

    if (channel && !channel.members.includes(user))
      slack.channels.update(channel.id, { members: [...channel.members, user] })
  }
}

function seedInstall(store: Store, slack: SlackStore, seed: SlackSeedInstall): void {
  const app = appByKey(slack, seed.app)
  const installer = findUser(slack, seed.installer ?? "") ?? slack.users.all().find((u) => !u.isBot)

  if (!installer) throw new Error("seed a member before installing a Slack app")

  const grant = installApp(slack, store.clock, {
    app,
    installer: installer.userId,
    botScopes: app.botScopes,
    userScopes: app.userScopes,
    webhookChannel: seed.webhook_channel,
    botToken: seed.bot_token,
    userToken: seed.user_token,
  })

  joinChannels(slack, grant.install.botUserId, seed.channels ?? [])
}

/** Members and channels, `#general` included. */
function seedPeople(slack: SlackStore, config: SlackSeedConfig): void {
  for (const user of config.users ?? []) seedUser(slack, user)

  const creator = slack.users.all()[0]?.userId ?? "USLACKBOT"

  for (const channel of config.channels ?? []) seedChannel(slack, channel, creator)
  ensureGeneral(slack, creator)
}

/** Loads a workspace into a Slack emulator's store. No events are sent for seeded data. */
export function seedSlack(store: Store, config: SlackSeedConfig): void {
  const slack = slackStore(store)

  seedTeam(slack, config.team)
  seedPeople(slack, config)
  for (const app of config.apps ?? []) seedApp(slack, app)
  for (const install of config.installations ?? []) seedInstall(store, slack, install)
}
