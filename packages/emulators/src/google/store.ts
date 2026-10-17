import { oauthTables } from "../oauth/pkce.ts"
import type { Store } from "../store.ts"
import type { GoogleOAuthClient, GoogleUser } from "./entities.ts"

/** The Google sign-in state held in an emulator's store. */
export function googleStore(store: Store) {
  return {
    users: store.collection<GoogleUser>("google.users", ["uid", "email"]),
    clients: store.collection<GoogleOAuthClient>("google.oauth_clients", ["client_id"]),
    ...oauthTables(store, "google"),
  }
}

export type GoogleStore = ReturnType<typeof googleStore>
