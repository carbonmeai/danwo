import type { calendar_v3, drive_v3 } from "googleapis"

import type { PersonName } from "../oauth/account.ts"
import type { Entity } from "../store.ts"

/**
 * A Google account that can sign in. `uid` is the numeric `sub` Google gives it; `hd` is the
 * Workspace domain, for accounts that have one.
 */
export type GoogleUser = Entity &
  PersonName & {
    uid: string
    email: string
    email_verified: boolean
    picture: string | null
    locale: string
    hd: string | null
  }

/** An OAuth client registered in the Google Cloud console. */
export type GoogleOAuthClient = Entity &
  Record<"client_id" | "client_secret" | "name", string> & { redirect_uris: string[] }

/**
 * One email in a Gmail mailbox. `owner` is the mailbox owner's `uid`, `raw` the RFC 2822 message
 * as text, `internalDate` when Gmail received it (milliseconds since the epoch) and `historyId`
 * the history id of its last change.
 */
export type GmailMessageRecord = Entity &
  Record<"messageId" | "threadId" | "owner" | "raw", string> &
  Record<"internalDate" | "historyId", number> & { labelIds: string[] }

/** A Gmail label: the system ones every mailbox has, or one the user made. */
export type GmailLabelRecord = Entity &
  Record<"labelId" | "owner" | "name", string> &
  Record<"messageListVisibility" | "labelListVisibility", string | null> & {
    type: "system" | "user"
    color: Record<"textColor" | "backgroundColor", string> | null
  }

export type GmailDraftRecord = Entity & { draftId: string; owner: string; messageId: string }

/** The kinds of change Gmail's history reports. */
export type GmailChange = "messageAdded" | "messageDeleted" | "labelAdded" | "labelRemoved"

/** One change to a mailbox, numbered by the history id it was given. */
export type GmailHistoryRecord = Entity & {
  owner: string
  historyId: number
  change: GmailChange
  messageId: string
  threadId: string
  /** The message's labels when added, or the labels added or removed. */
  labelIds: string[]
}

/** What `users.watch` asked for. */
export interface GmailWatch {
  topicName: string
  labelIds: string[]
  labelFilterBehavior: "include" | "exclude"
  expiration: number
}

/** Per-mailbox counters: the latest history id, the oldest one still kept, and the watch. */
export type GmailMailboxRecord = Entity & {
  owner: string
  historyId: number
  /** History ids below this are no longer kept; asking from one is a 404. */
  floor: number
  watch: GmailWatch | null
}

/** How a push subscription proves its pushes come from Google: an OIDC token for this account. */
export interface PushAuthentication {
  serviceAccountEmail: string
  /** The token's `aud`; the push endpoint when null. */
  audience: string | null
}

/**
 * A Pub/Sub push subscription: messages published to `topic` are POSTed to `endpoint`, with a
 * signed token in `Authorization` when `oidc` is set.
 */
export type PushSubscriptionRecord = Entity & {
  name: string
  topic: string
  endpoint: string
  oidc: PushAuthentication | null
}

/** A calendar a user owns. The primary calendar's id is the user's email. */
export type CalendarRecord = Entity & {
  calendarId: string
  owner: string
  summary: string
  description: string | null
  timeZone: string
  primary: boolean
  /** Sync tokens minted before this generation get 410 Gone. */
  generation: number
}

/** One event as the API returns it, plus the change counter sync tokens are built on. */
export type CalendarEventRecord = Entity & {
  calendarId: string
  eventId: string
  event: calendar_v3.Schema$Event
  /** A store-wide counter value from the event's last change. */
  changed: number
}

/** What a push channel watches. */
export type ChannelTarget =
  | { readonly kind: "calendar"; readonly calendarId: string }
  | { readonly kind: "file"; readonly fileId: string }
  | { readonly kind: "changes"; readonly owner: string }

/** A push notification channel opened by `watch`. */
export type ChannelRecord = Entity & {
  channelId: string
  resourceId: string
  resourceUri: string
  target: ChannelTarget
  address: string
  token: string | null
  /** Milliseconds since the epoch. */
  expiration: number
  messageNumber: number
}

/** A Drive file or folder as the API returns it, with its bytes and the app that made it. */
export type DriveFileRecord = Entity & {
  fileId: string
  owner: string
  file: drive_v3.Schema$File
  /** Base64 content; `null` for folders and files without content. */
  content: string | null
  /** The OAuth client that created the file, for `drive.file` access. */
  createdBy: string | null
  /** Who besides the owner may see or change it. */
  permissions: drive_v3.Schema$Permission[]
}

/** One change to Drive, numbered by its record id (the page token). */
export type DriveChangeRecord = Entity & {
  fileId: string
  removed: boolean
  /** Who could see the file when it changed. */
  viewers: string[]
}

/** A resumable upload waiting for its bytes. */
export type DriveUploadRecord = Entity & {
  uploadId: string
  owner: string
  clientId: string
  metadata: Record<string, unknown>
  /** The file being replaced, for an update; `null` for a new file. */
  fileId: string | null
  received: string
}
