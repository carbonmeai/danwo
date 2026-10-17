import { oauthTables } from "../oauth/pkce.ts"
import type { Store } from "../store.ts"
import type {
  CalendarEventRecord,
  CalendarRecord,
  ChannelRecord,
  DriveChangeRecord,
  DriveFileRecord,
  DriveUploadRecord,
  GmailDraftRecord,
  GmailHistoryRecord,
  GmailLabelRecord,
  GmailMailboxRecord,
  GmailMessageRecord,
  GoogleOAuthClient,
  GoogleUser,
  PushSubscriptionRecord,
} from "./entities.ts"

/** The Google state held in an emulator's store: sign-in, Gmail, Calendar and Drive. */
export function googleStore(store: Store) {
  return {
    users: store.collection<GoogleUser>("google.users", ["uid", "email"]),
    clients: store.collection<GoogleOAuthClient>("google.oauth_clients", ["client_id"]),
    ...oauthTables(store, "google"),
    ...gmailTables(store),
    ...pushTables(store),
    ...calendarTables(store),
    ...driveTables(store),
  }
}

/** Mailboxes: their messages, labels, drafts and history, and the per-mailbox counters. */
function gmailTables(store: Store) {
  const owned = ["owner"] as const

  return {
    messages: store.collection<GmailMessageRecord>("gmail.messages", ["messageId", ...owned]),
    labels: store.collection<GmailLabelRecord>("gmail.labels", owned),
    history: store.collection<GmailHistoryRecord>("gmail.history", owned),
    mailboxes: store.collection<GmailMailboxRecord>("gmail.mailboxes", owned),
  }
}

/** Where pushes go: Pub/Sub subscriptions and watch channels, plus Gmail drafts. */
function pushTables(store: Store) {
  return {
    drafts: store.collection<GmailDraftRecord>("gmail.drafts", ["draftId"]),
    subscriptions: store.collection<PushSubscriptionRecord>("pubsub.subscriptions", ["topic"]),
    channels: store.collection<ChannelRecord>("google.channels", ["channelId"]),
  }
}

function calendarTables(store: Store) {
  return {
    calendars: store.collection<CalendarRecord>("calendar.calendars", ["calendarId"]),
    events: store.collection<CalendarEventRecord>("calendar.events", ["calendarId"]),
  }
}

function driveTables(store: Store) {
  return {
    files: store.collection<DriveFileRecord>("drive.files", ["fileId"]),
    changes: store.collection<DriveChangeRecord>("drive.changes"),
    uploads: store.collection<DriveUploadRecord>("drive.uploads", ["uploadId"]),
  }
}

export type GoogleStore = ReturnType<typeof googleStore>
