/**
 * The page's live note: a Tiptap Cloud document (`wss://<appId>.collab.tiptap.cloud`, as Tiptap's
 * provider builds the URL) synced with Hocuspocus. "Write note" adds a paragraph the way the
 * editor stores one.
 */
import { HocuspocusProvider } from "@hocuspocus/provider"
import * as Y from "yjs"

declare global {
  interface Window {
    CONFIG: { collabApp: string; collabToken: string }
  }
}

addEventListener("DOMContentLoaded", () => {
  const show = (text: string) => {
    const state = document.getElementById("note-state")

    if (state) state.textContent = text
  }
  const provider = new HocuspocusProvider({
    url: `wss://${window.CONFIG.collabApp}.collab.tiptap.cloud?__version=3.7.2`,
    name: "order-notes",
    token: window.CONFIG.collabToken,
    document: new Y.Doc(),
    onSynced: () => show("note: synced"),
    onAuthenticationFailed: ({ reason }) => show(`note: refused (${reason})`),
  })

  document.getElementById("note")?.addEventListener("click", () => {
    const paragraph = new Y.XmlElement("paragraph")

    paragraph.insert(0, [new Y.XmlText("Deliver before noon")])
    provider.document.getXmlFragment("default").insert(0, [paragraph])
    show("note: written")
  })
})
