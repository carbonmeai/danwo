/** Unipile's objects: connected accounts with their chats, messages and mail, hosted links and webhooks. */
import { objectTable } from "../objects.ts"
import type { DataKey, Store } from "../store.ts"

export type UnipileAccountType = "LINKEDIN" | "WHATSAPP" | "GOOGLE_OAUTH" | "MAIL"

export type UnipileSourceStatus = "OK" | "STOPPED" | "ERROR" | "CREDENTIALS" | "CONNECTING"

/** A connected account, as `GET /accounts` lists it, plus who owns it. */
export interface UnipileAccountRecord {
  id: string
  type: UnipileAccountType
  name: string
  created_at: string
  status: UnipileSourceStatus
  /** The account's own profile: its provider id and how it is named there. */
  owner: { provider_id: string; first_name: string; last_name: string; username: string }
}

export interface UnipileAttendee {
  id: string
  account_id: string
  provider_id: string
  name: string
  is_self: 0 | 1
  profile_url: string
}

export interface UnipileChatRecord {
  id: string
  account_id: string
  provider_id: string
  name: string | null
  attendee_ids: string[]
  unread_count: number
  timestamp: string | null
}

export interface UnipileMessageRecord {
  id: string
  account_id: string
  chat_id: string
  provider_id: string
  sender_id: string
  sender_attendee_id: string
  text: string | null
  timestamp: string
  is_sender: 0 | 1
  seen: 0 | 1
}

export interface UnipileEmailRecord {
  id: string
  account_id: string
  provider_id: string
  message_id: string
  date: string
  subject: string
  body: string
  from: { display_name: string; identifier: string }
  to: { display_name: string; identifier: string }[]
  folders: string[]
  role: "inbox" | "sent"
  tracking_id: string
}

/** A hosted auth link waiting to be opened. */
export interface UnipileLinkRecord {
  id: string
  type: "create" | "reconnect"
  providers: string[]
  name: string | null
  notify_url: string | null
  success_redirect_url: string | null
  failure_redirect_url: string | null
  reconnect_account: string | null
  expires_on: string
}

export interface UnipileWebhookRecord {
  id: string
  source: "messaging" | "email" | "account_status" | "email_tracking"
  request_url: string
  name: string
  headers: { key: string; value: string }[]
  account_ids: string[]
  events: string[]
  enabled: boolean
}

const TOKENS: DataKey<string[]> = { name: "unipile.tokens" }
const NOTIFY: DataKey<string[]> = { name: "unipile.notify_urls" }
const COUNTER: DataKey<number> = { name: "unipile.counter" }

/** The Unipile objects held in an emulator's store. */
export function unipileStore(store: Store) {
  return {
    accounts: objectTable<UnipileAccountRecord>(store, "unipile.accounts"),
    attendees: objectTable<UnipileAttendee>(store, "unipile.attendees"),
    chats: objectTable<UnipileChatRecord>(store, "unipile.chats"),
    messages: objectTable<UnipileMessageRecord>(store, "unipile.messages"),
    emails: objectTable<UnipileEmailRecord>(store, "unipile.emails"),
    links: objectTable<UnipileLinkRecord>(store, "unipile.links"),
    webhooks: objectTable<UnipileWebhookRecord>(store, "unipile.webhooks"),
    /** The access tokens accepted; when none are seeded, any non-empty one is. */
    tokens: () => store.getData(TOKENS) ?? [],
    addTokens: (tokens: readonly string[]) =>
      store.setData(TOKENS, [...(store.getData(TOKENS) ?? []), ...tokens]),
    /** Every hosted link's notify URL, so its notifications have somewhere to go. */
    notifyUrls: () => store.getData(NOTIFY) ?? [],
    addNotifyUrl: (url: string) =>
      store.setData(NOTIFY, [...new Set([...(store.getData(NOTIFY) ?? []), url])]),
    /** A number that goes up by one on every call, for ids. */
    next(): number {
      const n = (store.getData(COUNTER) ?? 0) + 1

      store.setData(COUNTER, n)

      return n
    },
  }
}

export type UnipileStore = ReturnType<typeof unipileStore>
