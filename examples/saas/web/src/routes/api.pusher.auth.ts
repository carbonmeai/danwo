/**
 * Where pusher-js asks to join a workspace's private channel. The API signs the subscription only
 * for a member of that workspace.
 */
import { createFileRoute } from "@tanstack/react-router"

import { write } from "../lib/api"

export const Route = createFileRoute("/api/pusher/auth")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const form = new URLSearchParams(await request.text())
        const signed = await write("/realtime/auth", {
          socket_id: form.get("socket_id") ?? "",
          channel_name: form.get("channel_name") ?? "",
        })

        return signed.ok
          ? Response.json(signed.data)
          : Response.json({ error: signed.error }, { status: 403 })
      },
    },
  },
})
