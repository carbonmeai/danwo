import type { Entity } from "../store.ts"

/** The workspace an emulator serves. */
export type TeamRecord = Entity & Record<"teamId" | "name" | "domain", string>

/**
 * A member of the workspace; bot users are members too, with a `botId` and their app's id. A member
 * from another workspace through Slack Connect has that workspace's `teamId` (null means this
 * workspace), and `isStranger` when the app shares no channel it can see with them.
 */
export type UserRecord = Entity &
  Record<"userId" | "name" | "realName", string> &
  Record<"email" | "botId" | "appId" | "teamId", string | null> &
  Record<"isAdmin" | "isBot" | "deleted" | "isStranger", boolean>

export type ChannelKind = "channel" | "group" | "im" | "mpim"

/**
 * A conversation: a public or private channel, a DM or a group DM. `extShared` is a Slack Connect
 * channel, shared with another workspace; it stays shared once it has been.
 */
export type ChannelRecord = Entity &
  Record<"channelId" | "name" | "creator" | "topic" | "purpose", string> & {
    kind: ChannelKind
    members: string[]
    archived: boolean
    extShared: boolean
  }

export type Reaction = { name: string; users: string[] }

/** A file shared into a message. */
export type SharedFile = Record<"id" | "name" | "title", string> & { size: number }

/** A message in a conversation. Thread replies carry the parent's `threadTs`. */
export type MessageRecord = Entity &
  Record<"channel" | "ts" | "user" | "text", string> &
  Record<"botId" | "appId" | "threadTs" | "subtype" | "editedTs", string | null> &
  Record<"blocks" | "attachments", unknown[] | null> & {
    reactions: Reaction[]
    files: SharedFile[]
  }

/** A message only one member sees. */
export type EphemeralRecord = Entity &
  Record<"channel" | "user" | "ts" | "text", string> & {
    blocks: unknown[] | null
    appId: string | null
  }

/** Where an app wants a slash command delivered. */
export type CommandSetting = Record<"command" | "url", string>

/** An app registered with the workspace, as its configuration page would hold it. */
export type AppRecord = Entity &
  Record<"appId" | "name" | "clientId" | "clientSecret" | "signingSecret", string> &
  Record<"verificationToken", string> &
  Record<"redirectUrls" | "botScopes" | "userScopes" | "botEvents", string[]> &
  Record<"eventsUrl" | "interactivityUrl", string | null> & {
    commands: CommandSetting[]
    tokenRotation: boolean
  }

/** An app installed in the workspace: its bot user and the scopes granted to it. */
export type InstallationRecord = Entity &
  Record<"appId" | "teamId" | "botUserId" | "botId" | "installer", string> &
  Record<"botScopes" | "userScopes", string[]> & { webhookChannel: string | null }

export type TokenKind = "bot" | "user"

/** An access token, with the refresh token that renews it when rotation is on. */
export type TokenRecord = Entity &
  Record<"token" | "appId" | "teamId" | "userId", string> & {
    kind: TokenKind
    scopes: string[]
    expiresAt: number | null
    refreshToken: string | null
    revoked: boolean
  }

/** What an install asks for: the app, the scopes and where to send the browser back. */
type InstallAsk = Record<"appId" | "redirectUri", string> &
  Record<"botScopes" | "userScopes", string[]>

/** An install that waits on the consent page. */
export type PendingInstall = Entity & InstallAsk & { requestId: string; state: string | null }

/** A code the consent page handed back, exchanged once at `oauth.v2.access`. */
export type InstallCode = Entity &
  InstallAsk & { code: string; installer: string; expiresAt: number }

/** An incoming webhook URL: posting to it posts into its channel as the app. */
export type IncomingWebhookRecord = Entity & Record<"path" | "appId" | "channel", string>

/** A `response_url` handed out with a command or an interaction. */
export type ResponseUrlRecord = Entity &
  Record<"path" | "appId" | "channel" | "user", string> &
  Record<"uses" | "expiresAt", number> & { messageTs: string | null }

/** A trigger id, good for one `views.open` within a few seconds. */
export type TriggerRecord = Entity &
  Record<"triggerId" | "appId" | "user", string> & { expiresAt: number; used: boolean }

/**
 * A modal or App Home view an app opened or published. A pushed modal names the view it was pushed
 * over and the first view of its stack; `errors` are the block errors the app answered a submission
 * with, shown until the next one; a closed view is gone from the member's screen.
 */
export type ViewRecord = Entity &
  Record<"viewId" | "appId" | "user" | "hash", string> &
  Record<"externalId" | "rootViewId" | "previousViewId", string | null> & {
    view: Record<string, unknown>
    errors: Record<string, string> | null
    closed: boolean
  }

/** A file upload: reserved by `getUploadURLExternal`, filled by the upload, then shared. */
export type FileRecord = Entity &
  Record<"fileId" | "appId" | "user" | "name" | "title", string> & {
    length: number
    content: string | null
  }

/** A message waiting to be posted at `postAt` (Unix seconds). */
export type ScheduledRecord = Entity &
  Record<"scheduledId" | "appId" | "channel" | "text", string> & {
    threadTs: string | null
    postAt: number
    posted: boolean
  }
