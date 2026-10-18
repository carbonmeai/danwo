import type { ClientJSON } from "@clerk/backend"

import type { ClerkContext } from "./context.ts"
import type { ClientRecord } from "./store.ts"

/** A client as the Backend API answers it, with its sessions inline. */
export function clientJson(context: ClerkContext, client: ClientRecord): ClientJSON {
  const sessions = client.session_ids.flatMap((id) => context.clerk.sessions.get(id) ?? [])

  return {
    object: "client",
    id: client.id,
    session_ids: client.session_ids,
    sessions,
    sign_in_id: client.sign_in_id,
    sign_up_id: client.sign_up_id,
    last_active_session_id: client.last_active_session_id,
    last_authentication_strategy: null,
    created_at: client.created_at,
    updated_at: client.updated_at,
  }
}
