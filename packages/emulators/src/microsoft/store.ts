import { oauthTables } from "../oauth/pkce.ts"
import type { Store } from "../store.ts"
import type { MicrosoftOAuthClient, MicrosoftUser } from "./entities.ts"

/** The Microsoft sign-in state held in an emulator's store. */
export function microsoftStore(store: Store) {
  return {
    users: store.collection<MicrosoftUser>("microsoft.users", ["oid", "email"]),
    clients: store.collection<MicrosoftOAuthClient>("microsoft.oauth_clients", ["client_id"]),
    ...oauthTables(store, "microsoft"),
  }
}

export type MicrosoftStore = ReturnType<typeof microsoftStore>
