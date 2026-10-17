import { oauthTables } from "../oauth/pkce.ts"
import type { Entity, Store } from "../store.ts"
import type {
  CalendarRecord,
  ChangeRecord,
  DriveItemRecord,
  DriveRecord,
  EventRecord,
  MailFolderRecord,
  MessageRecord,
  MicrosoftOAuthClient,
  MicrosoftUser,
  SharingLinkRecord,
  SubscriptionRecord,
  UploadSessionRecord,
} from "./entities.ts"

/** Records that belong to a user and are looked up by Graph id. */
type Owned = Entity & { graphId: string; owner: string }

/** Mailboxes, calendars and drives: one table per kind, indexed by Graph id and owner. */
function ownedTables(store: Store) {
  const owned = <T extends Owned>(kind: string) =>
    store.collection<T>(`microsoft.${kind}`, ["graphId", "owner"])

  return {
    folders: owned<MailFolderRecord>("mail_folders"),
    messages: owned<MessageRecord>("messages"),
    calendars: owned<CalendarRecord>("calendars"),
    events: owned<EventRecord>("events"),
    drives: owned<DriveRecord>("drives"),
  }
}

/** Drive contents, upload sessions and sharing links, and the change log subscriptions read. */
function driveAndSyncTables(store: Store) {
  const table = <T extends Entity>(kind: string, ...indexed: (keyof T)[]) =>
    store.collection<T>(`microsoft.${kind}`, indexed)

  return {
    items: table<DriveItemRecord>("drive_items", "graphId", "driveId", "downloadToken"),
    uploads: table<UploadSessionRecord>("upload_sessions", "graphId"),
    links: table<SharingLinkRecord>("sharing_links", "itemId"),
    subscriptions: table<SubscriptionRecord>("subscriptions", "graphId"),
    changes: table<ChangeRecord>("changes", "owner"),
  }
}

/** The Microsoft sign-in and Graph state held in an emulator's store. */
export function microsoftStore(store: Store) {
  return {
    users: store.collection<MicrosoftUser>("microsoft.users", ["oid", "email"]),
    clients: store.collection<MicrosoftOAuthClient>("microsoft.oauth_clients", ["client_id"]),
    ...oauthTables(store, "microsoft"),
    ...ownedTables(store),
    ...driveAndSyncTables(store),
  }
}

export type MicrosoftStore = ReturnType<typeof microsoftStore>
