import { defineEmulator } from "../define.ts"
import { HttpError } from "../errors.ts"
import type { Store } from "../store.ts"
import type { TiptapCollab } from "./collab.ts"
import type { TiptapDocuments } from "./documents.ts"
import { registerTiptap, tiptapServer } from "./inspect.ts"
import { seedTiptapApps, type TiptapSeedConfig } from "./seed.ts"

export type { TiptapTrouble } from "./apps.ts"
export { tiptapOutboundFaults } from "./faults.ts"
export { tiptapCollab, type TiptapCollabView } from "./inspect.ts"
export type { ProseMirrorNode as TiptapNode } from "./prosemirror.ts"
export type { TiptapSeedApp, TiptapSeedConfig } from "./seed.ts"

/** The packages the collaboration server runs on, which a project using Tiptap's collaboration has. */
const YJS_PACKAGES = ["yjs", "y-protocols", "lib0"] as const

/**
 * The collaboration server, or the error that says which of its packages the project lacks.
 * Loaded here rather than imported, so danwo installs no Yjs for the many projects without Tiptap.
 */
const server = await import("./server.ts").catch((error: unknown) => {
  const missing = YJS_PACKAGES.find((name) => missingPackage(error, name))

  if (missing === undefined) throw error

  return new Error(
    `the Tiptap emulator needs yjs and y-protocols, as Tiptap's collaboration does: ` +
      `npm install -D yjs y-protocols (Node found no ${missing})`,
    { cause: error },
  )
})

/** Whether `error` is Node's failure to find the package `name`. */
function missingPackage(error: unknown, name: string): boolean {
  if (!(error instanceof Error)) return false

  const code: unknown = Reflect.get(error, "code")

  return (
    (code === "ERR_MODULE_NOT_FOUND" || code === "MODULE_NOT_FOUND") &&
    [`'${name}'`, `'${name}/`].some((quoted) => error.message.includes(`package ${quoted}`))
  )
}

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
    if (server instanceof Error) throw server

    const documents: TiptapDocuments = new server.TiptapDocuments(store, clock)
    const collab: TiptapCollab = new server.TiptapCollab(store, documents)

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
    server.tiptapRoutes({ app, store, documents })
  },
  sockets: ({ store }) => {
    const { collab } = tiptapServer(store)

    return (socket, upgrade) => collab.open(socket, upgrade)
  },
})
