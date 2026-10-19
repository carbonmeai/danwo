import type { Store } from "../store.ts"
import { appTable } from "./documents.ts"
import type { ProseMirrorNode } from "./prosemirror.ts"

/** A collaboration app: the id in its host, and what its tokens and API calls must carry. */
export type TiptapSeedApp = { readonly id: string } & Partial<{
  /** Verifies the JWTs editors connect with (`TIPTAP_COLLAB_SECRET`); unset takes any token. */
  readonly secret: string
  /** What the REST API's `Authorization` header must be (`TIPTAP_API_KEY`); unset takes any. */
  readonly apiKey: string
}>

/** Data to load into a Tiptap emulator. */
export type TiptapSeedConfig = Partial<{
  readonly apps: readonly TiptapSeedApp[]
  /** Documents to start with, by name, as ProseMirror JSON. */
  readonly documents: Readonly<Record<string, ProseMirrorNode>>
}>

/** Loads the apps of `config`; documents need the live server, so `seedTiptap` applies those. */
export function seedTiptapApps(store: Store, config: TiptapSeedConfig): void {
  const apps = appTable(store)

  for (const app of config.apps ?? []) {
    apps.remove(app.id)
    apps.add({ id: app.id, secret: app.secret ?? null, api_key: app.apiKey ?? null }, null)
  }
}
