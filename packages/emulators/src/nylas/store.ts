import { objectTable } from "../objects.ts"
import type { DataKey, Store } from "../store.ts"
import type {
  NylasBooking,
  NylasCalendar,
  NylasCode,
  NylasConfiguration,
  NylasContact,
  NylasDraft,
  NylasEvent,
  NylasFolder,
  NylasGrant,
  NylasMessage,
  NylasThread,
  NylasToken,
  NylasWebhook,
} from "./entities.ts"

/** Attachment bytes, kept beside the message that carries them. */
export interface StoredFile {
  id: string
  grant_id: string
  message_id: string
  content: string
}

const API_KEYS: DataKey<string[]> = { name: "nylas.api_keys" }
const COUNTER: DataKey<number> = { name: "nylas.counter" }
const APPLICATION: DataKey<string> = { name: "nylas.application_id" }

/** The Nylas objects held in an emulator's store. */
export function nylasStore(store: Store) {
  return {
    grants: objectTable<NylasGrant>(store, "nylas.grants"),
    folders: objectTable<NylasFolder>(store, "nylas.folders"),
    messages: objectTable<NylasMessage>(store, "nylas.messages"),
    threads: objectTable<NylasThread>(store, "nylas.threads"),
    drafts: objectTable<NylasDraft>(store, "nylas.drafts"),
    files: objectTable<StoredFile>(store, "nylas.files"),
    calendars: objectTable<NylasCalendar>(store, "nylas.calendars"),
    events: objectTable<NylasEvent>(store, "nylas.events"),
    contacts: objectTable<NylasContact>(store, "nylas.contacts"),
    configurations: objectTable<NylasConfiguration>(store, "nylas.configurations"),
    bookings: objectTable<NylasBooking & { id: string }>(store, "nylas.bookings"),
    webhooks: objectTable<NylasWebhook>(store, "nylas.webhooks"),
    codes: objectTable<NylasCode>(store, "nylas.codes"),
    tokens: objectTable<NylasToken>(store, "nylas.tokens"),
    /** The API keys accepted; when none are seeded, any `nyk_` key is. */
    apiKeys: () => store.getData(API_KEYS) ?? [],
    addApiKeys: (keys: readonly string[]) =>
      store.setData(API_KEYS, [...(store.getData(API_KEYS) ?? []), ...keys]),
    /** The application id events and tokens carry. */
    applicationId: () => store.getData(APPLICATION) ?? "danwo-nylas-application",
    setApplicationId: (id: string) => store.setData(APPLICATION, id),
    /** A number that goes up by one on every call, for ids. */
    next(): number {
      const n = (store.getData(COUNTER) ?? 0) + 1

      store.setData(COUNTER, n)

      return n
    },
  }
}

export type NylasStore = ReturnType<typeof nylasStore>
