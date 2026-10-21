/**
 * Live notes: the browser subscribes to its workspace's private Pusher channel (the web server
 * signs the subscription for members only) and hears of every note published there.
 */
import Pusher from "pusher-js"
import { useEffect, useRef } from "react"

import type { Note } from "./types"

/** Calls `onNote` for every note published in the workspace while the page is open. */
export function useLiveNotes(
  config: { readonly key: string; readonly cluster: string },
  workspaceId: string,
  onNote: (note: Note) => void,
): void {
  /* The latest handler, so the socket is opened once per workspace, not once per render. */
  const handler = useRef(onNote)

  handler.current = onNote

  useEffect(() => {
    if (!config.key) return undefined

    const pusher = new Pusher(config.key, {
      cluster: config.cluster,
      channelAuthorization: { endpoint: "/api/pusher/auth", transport: "ajax" },
    })
    const channel = pusher.subscribe(`private-workspace-${workspaceId}`)

    channel.bind("note.published", (note: Note) => handler.current(note))

    return () => {
      channel.unbind_all()
      pusher.disconnect()
    }
  }, [config.key, config.cluster, workspaceId])
}
