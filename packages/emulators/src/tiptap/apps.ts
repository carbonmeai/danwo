/** What the Tiptap emulator keeps without Yjs: its apps, and the trouble tests ask for. */
import { objectTable } from "../objects.ts"
import type { Store } from "../store.ts"

/** A collaboration app (`<appId>.collab.tiptap.cloud`): what signs its tokens and calls its API. */
export interface TiptapApp {
  id: string
  /** Verifies the JWTs clients connect with (`TIPTAP_COLLAB_SECRET`); none accepts any token. */
  secret: string | null
  /** What the REST API's `Authorization` header must be (`TIPTAP_API_KEY`); none accepts any. */
  api_key: string | null
}

/** What tests asked the server to do badly: refuse tokens, or answer syncs late. */
export interface TiptapTrouble {
  readonly permissionDenied: boolean
  readonly syncDelayMs: number
}

/** The collaboration apps of an emulator's store. */
export function appTable(store: Store) {
  return objectTable<TiptapApp>(store, "tiptap.apps")
}
