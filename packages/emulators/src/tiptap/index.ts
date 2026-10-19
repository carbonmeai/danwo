import { defineEmulator } from "../define.ts"
import { HttpError } from "../errors.ts"
import type { Store } from "../store.ts"
import { TiptapCollab } from "./collab.ts"
import { TiptapDocuments } from "./documents.ts"
import { registerTiptap, tiptapServer } from "./inspect.ts"
import { tiptapRoutes } from "./routes.ts"
import { seedTiptapApps, type TiptapSeedConfig } from "./seed.ts"

export type { TiptapTrouble } from "./documents.ts"
export { tiptapOutboundFaults } from "./faults.ts"
export { tiptapCollab, type TiptapCollabView } from "./inspect.ts"
export type { ProseMirrorNode as TiptapNode } from "./prosemirror.ts"
export type { TiptapSeedApp, TiptapSeedConfig } from "./seed.ts"

/** The hosts the Tiptap emulator answers: every collaboration app (`<appId>.collab.tiptap.cloud`). */
export const TIPTAP_HOSTS: readonly string[] = ["*.collab.tiptap.cloud"]

/** Loads `config` into a Tiptap emulator: its apps, and documents written as ProseMirror JSON. */
export function seedTiptap(emulator: { readonly store: Store }, config: TiptapSeedConfig): void {
  seedTiptapApps(emulator.store, config)

  const { documents } = tiptapServer(emulator.store)

  for (const [name, doc] of Object.entries(config.documents ?? {})) documents.replace(name, doc)
}

/**
 * Tiptap Cloud collaboration: the WebSocket server `@hocuspocus/provider` and Tiptap's
 * `TiptapCollabProvider` sync documents with (tokens checked against the app's secret, the Yjs
 * sync protocol, awareness, Tiptap's stateless messages), and the documents REST API. Several
 * editors of one document see each other's changes; read what a document says with
 * `tiptapCollab(tiptap).text(name)`.
 */
export const tiptap = defineEmulator({
  name: "tiptap",
  setup({ app, store, clock }) {
    const documents = new TiptapDocuments(store, clock)
    const collab = new TiptapCollab(store, documents)

    registerTiptap(store, documents, collab)
    store.whenReset(() => {
      collab.closeAll()
      documents.forget()
    })

    app.onError((error, c) => {
      const status = error instanceof HttpError ? error.status : 500

      return c.json(
        { error: error instanceof Error ? error.message : "Internal Server Error" },
        status,
      )
    })
    tiptapRoutes({ app, store, documents })
  },
  sockets: ({ store }) => {
    const { collab } = tiptapServer(store)

    return (socket, upgrade) => collab.open(socket, upgrade)
  },
})
