/** What tests read from and do to a Tiptap emulator besides calling its API. */
import type { Emulator } from "../define.ts"
import { waitUntil } from "../poll.ts"
import type { Store } from "../store.ts"
import type { TiptapCollab } from "./collab.ts"
import type { TiptapDocuments, TiptapTrouble } from "./documents.ts"
import type { ProseMirrorNode } from "./prosemirror.ts"

/** Each emulator's live server, by its store. */
const SERVERS = new WeakMap<Store, { documents: TiptapDocuments; collab: TiptapCollab }>()

export function registerTiptap(
  store: Store,
  documents: TiptapDocuments,
  collab: TiptapCollab,
): void {
  SERVERS.set(store, { documents, collab })
}

export function tiptapServer(store: Store): { documents: TiptapDocuments; collab: TiptapCollab } {
  const found = SERVERS.get(store)

  if (found === undefined) throw new Error("not a Tiptap emulator")

  return found
}

/** A Tiptap emulator's documents and editors as tests read and drive them. */
export interface TiptapCollabView {
  /** The names of every document, oldest first. */
  names(): string[]
  /** A document as ProseMirror JSON (its `default` fragment unless named). */
  json(name: string, fragment?: string): ProseMirrorNode
  /** A document's plain text, one block per line. */
  text(name: string, fragment?: string): string
  /** Waits up to `timeoutMs` (10 s by default) until a document's text contains `text`. */
  waitForText(name: string, text: string, options?: { timeoutMs?: number }): Promise<string>
  /** Sets a document's content from ProseMirror JSON, as a server-side change editors receive. */
  write(name: string, doc: ProseMirrorNode): void
  /** How many connections are editing a document right now. */
  editors(name: string): number
  /** Refuses tokens, or holds every sync answer back by `syncDelayMs`, until set back. */
  trouble(trouble: Partial<TiptapTrouble>): void
}

/** A Tiptap emulator's documents as JSON or text, who is editing them, and their faults. */
export function tiptapCollab(emulator: Pick<Emulator, "store">): TiptapCollabView {
  const server = () => tiptapServer(emulator.store)

  return {
    names: () =>
      server()
        .documents.list()
        .map((doc) => doc.id),
    json: (name, fragment) => server().documents.json(name, fragment),
    text: (name, fragment) => server().documents.text(name, fragment),
    waitForText: (name, text, options = {}) =>
      waitUntil(
        () => {
          if (!server().documents.has(name)) return undefined

          const now = server().documents.text(name)

          return now.includes(text) ? now : undefined
        },
        options.timeoutMs ?? 10_000,
        `document ${name} never contained "${text}"`,
      ),
    write: (name, doc) => server().documents.replace(name, doc),
    editors: (name) => server().collab.editors(name),
    trouble: (trouble) => server().documents.setTrouble(trouble),
  }
}
