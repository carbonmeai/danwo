/**
 * The collaboration server's documents. Each is a live `Y.Doc` while the emulator runs, and its
 * full state is written to the store after every change, so a snapshot, a restore or a failed
 * run's record holds every document as it was.
 */
import * as Y from "yjs"

import { objectTable } from "../objects.ts"
import type { Clock, DataKey, Store } from "../store.ts"
import { fragmentToJson, type ProseMirrorNode, replaceFragment, textOf } from "./prosemirror.ts"

/** One document as the store keeps it. */
export interface TiptapDocumentRecord {
  /** The document name clients and the REST API use. */
  id: string
  /** `Y.encodeStateAsUpdate` of the document, base64. */
  state: string
  /** Bytes of the encoded state. */
  size: number
  created: string
  changed: string
}

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

const TROUBLE: DataKey<TiptapTrouble> = { name: "tiptap.trouble" }

/** The fragment Tiptap's editor and REST API use unless told another. */
export const DEFAULT_FRAGMENT = "default"

/** The documents of one emulator, live and stored. */
export class TiptapDocuments {
  private readonly live = new Map<string, Y.Doc>()
  private readonly table: ReturnType<typeof documentTable>
  private readonly store: Store
  private readonly clock: Clock
  private readonly listeners = new Set<
    (name: string, update: Uint8Array, origin: unknown) => void
  >()

  constructor(store: Store, clock: Clock) {
    this.store = store
    this.clock = clock
    this.table = documentTable(store)
    /* Made up front, so every snapshot holds the same collections whatever ran first. */
    appTable(store)
  }

  /** Whether a document exists. */
  has(name: string): boolean {
    return this.table.get(name) !== undefined
  }

  /** The live document, created (empty) when it does not exist yet. */
  open(name: string): Y.Doc {
    const found = this.live.get(name)

    if (found) return found

    const doc = new Y.Doc()
    const stored = this.table.get(name)

    if (stored) Y.applyUpdate(doc, Buffer.from(stored.state, "base64"))
    else this.persist(name, doc)

    doc.on("update", (update: Uint8Array, origin: unknown) => {
      this.persist(name, doc)
      for (const listener of this.listeners) listener(name, update, origin)
    })
    this.live.set(name, doc)

    return doc
  }

  /** Calls `listener` on every change to any document, with the Yjs update and its origin. */
  onUpdate(listener: (name: string, update: Uint8Array, origin: unknown) => void): void {
    this.listeners.add(listener)
  }

  /** Every stored document, oldest first. */
  list(): TiptapDocumentRecord[] {
    return this.table.all()
  }

  /** A document's fragment as ProseMirror JSON. */
  json(name: string, fragment = DEFAULT_FRAGMENT): ProseMirrorNode {
    return fragmentToJson(this.open(name).getXmlFragment(fragment))
  }

  /** A document's plain text. */
  text(name: string, fragment = DEFAULT_FRAGMENT): string {
    return textOf(this.json(name, fragment))
  }

  /** A document's full state as a Yjs update. */
  update(name: string): Uint8Array {
    return Y.encodeStateAsUpdate(this.open(name))
  }

  /** Applies a Yjs update to a document (creating it). */
  applyUpdate(name: string, update: Uint8Array, origin: unknown): void {
    Y.applyUpdate(this.open(name), update, origin)
  }

  /** Replaces a document's fragment with ProseMirror JSON, as one change editors receive. */
  replace(name: string, doc: ProseMirrorNode, fragment = DEFAULT_FRAGMENT): void {
    replaceFragment(this.open(name).getXmlFragment(fragment), doc)
  }

  /** Removes a document; editors still connected keep their copy. */
  remove(name: string): boolean {
    this.live.get(name)?.destroy()
    this.live.delete(name)

    return this.table.remove(name)
  }

  /** Forgets the live documents; the store's copies are what a restore put back. */
  forget(): void {
    for (const doc of this.live.values()) doc.destroy()
    this.live.clear()
  }

  trouble(): TiptapTrouble {
    return this.store.getData(TROUBLE) ?? { permissionDenied: false, syncDelayMs: 0 }
  }

  setTrouble(trouble: Partial<TiptapTrouble>): void {
    this.store.setData(TROUBLE, { ...this.trouble(), ...trouble })
  }

  private persist(name: string, doc: Y.Doc): void {
    const state = Buffer.from(Y.encodeStateAsUpdate(doc)).toString("base64")
    const now = this.clock().toISOString()
    const fields = { state, size: Buffer.byteLength(state, "base64"), changed: now }

    if (this.table.get(name)) this.table.change(name, fields)
    else this.table.add({ id: name, created: now, ...fields }, null)
  }
}

export function documentTable(store: Store) {
  return objectTable<TiptapDocumentRecord>(store, "tiptap.documents")
}

export function appTable(store: Store) {
  return objectTable<TiptapApp>(store, "tiptap.apps")
}
