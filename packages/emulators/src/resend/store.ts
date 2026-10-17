import { objectTable } from "../objects.ts"
import type { Store } from "../store.ts"
import type { Domain, Email, Key, KeyToken, Webhook } from "./entities.ts"

/** The Resend objects held in an emulator's store. */
export function resendStore(store: Store) {
  return {
    emails: objectTable<Email>(store, "resend.emails"),
    domains: objectTable<Domain>(store, "resend.domains"),
    keys: objectTable<Key, KeyToken>(store, "resend.api_keys"),
    webhooks: objectTable<Webhook>(store, "resend.webhooks"),
  }
}

export type ResendStore = ReturnType<typeof resendStore>
