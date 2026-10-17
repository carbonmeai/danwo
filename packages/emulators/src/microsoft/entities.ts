import type { DayOfWeek } from "@microsoft/microsoft-graph-types"

import type { PersonName } from "../oauth/account.ts"
import type { Entity } from "../store.ts"

/**
 * A Microsoft account (personal or work) that can sign in: `oid` is its object id, `tenant_id`
 * the directory it lives in (personal accounts share the consumer tenant).
 */
export type MicrosoftUser = Entity & PersonName & Record<"oid" | "email" | "tenant_id", string>

/** An app registration in Microsoft Entra ID. */
export type MicrosoftOAuthClient = Entity &
  Record<"client_id" | "client_secret" | "name" | "tenant_id", string> & { redirect_uris: string[] }

/** Everything in a mailbox, calendar or drive belongs to one user and has a Graph id. */
interface Owned extends Entity {
  /** The Graph id clients see. */
  graphId: string
  /** The owner's object id. */
  owner: string
}

/** The folders every mailbox has, by the names Graph accepts in place of their ids. */
export type WellKnownFolder =
  | "inbox"
  | "drafts"
  | "sentitems"
  | "deleteditems"
  | "archive"
  | "junkemail"

export interface MailFolderRecord extends Owned {
  displayName: string
  wellKnown: WellKnownFolder | null
  /** `null` for top-level folders, which sit under the mailbox root. */
  parentId: string | null
}

/** A name and address, as Graph writes recipients. */
export interface Address {
  name: string
  address: string
}

export interface MailAttachment {
  graphId: string
  name: string
  contentType: string
  /** The file's bytes, base64. */
  contentBytes: string
  size: number
  isInline: boolean
}

export interface MessageRecord extends Owned {
  folderId: string
  subject: string
  bodyType: "text" | "html"
  body: string
  from: Address | null
  to: Address[]
  cc: Address[]
  bcc: Address[]
  replyTo: Address[]
  isRead: boolean
  isDraft: boolean
  importance: "low" | "normal" | "high"
  categories: string[]
  flagged: boolean
  receivedAt: string
  sentAt: string | null
  conversationId: string
  internetMessageId: string
  changeKey: string
  attachments: MailAttachment[]
}

export interface CalendarRecord extends Owned {
  name: string
  isDefault: boolean
}

/** How a series repeats: Graph's `patternedRecurrence`, kept as sent. */
export interface Recurrence {
  pattern: {
    type: "daily" | "weekly" | "absoluteMonthly"
    interval: number
    daysOfWeek?: DayOfWeek[]
    dayOfMonth?: number
  }
  range: {
    type: "endDate" | "noEnd" | "numbered"
    startDate: string
    endDate?: string
    numberOfOccurrences?: number
  }
}

export interface EventRecord extends Owned {
  calendarId: string
  subject: string
  bodyType: "text" | "html"
  body: string
  /** Start and end as UTC instants. */
  start: string
  end: string
  /** The time zone the event was created in, for its `originalStartTimeZone`. */
  timeZone: string
  isAllDay: boolean
  location: string
  attendees: Array<Address & { type: "required" | "optional" | "resource" }>
  showAs: "free" | "tentative" | "busy" | "oof" | "workingElsewhere" | "unknown"
  isCancelled: boolean
  recurrence: Recurrence | null
  changeKey: string
}

export interface DriveRecord extends Owned {
  driveType: "personal" | "business"
}

export interface DriveItemRecord extends Owned {
  driveId: string
  name: string
  /** `null` only for the drive's root. */
  parentId: string | null
  isFolder: boolean
  /** The file's bytes, base64; `null` for folders. */
  content: string | null
  mimeType: string | null
  /** Bumped on every change; the item's eTag and cTag derive from it. */
  version: number
  /** Unguessable part of the item's pre-authenticated download URL. */
  downloadToken: string
}

/** A resumable upload in progress. */
export interface UploadSessionRecord extends Owned {
  driveId: string
  parentId: string
  name: string
  conflict: ConflictBehavior
  total: number
  /** Bytes received so far, base64. */
  received: string
  expiresAt: string
}

/** What to do when an upload or new folder meets an item with the same name. */
export type ConflictBehavior = "fail" | "replace" | "rename"

export interface SharingLinkRecord extends Owned {
  itemId: string
  type: "view" | "edit"
  scope: "anonymous" | "organization"
}

/** What a subscription watches: a mailbox (or one folder of it), a calendar, or a drive. */
export type WatchedResource =
  | { readonly kind: "message"; readonly folderId: string | null }
  | { readonly kind: "event" }
  | { readonly kind: "drive"; readonly driveId: string }

export interface SubscriptionRecord extends Owned {
  clientId: string
  /** The resource path as the app sent it. */
  resource: string
  watches: WatchedResource
  changeTypes: Array<"created" | "updated" | "deleted">
  notificationUrl: string
  clientState: string | null
  expiresAt: string
}

/**
 * One change to something a user owns, in the order it happened: delta queries replay these
 * after their token, and subscriptions are notified from them. `folderId` is the mail folder a
 * message was in (a move records one change for each side).
 */
export interface ChangeRecord extends Entity {
  owner: string
  kind: "message" | "event" | "drive"
  targetId: string
  folderId: string | null
  changeType: "created" | "updated" | "deleted"
}
