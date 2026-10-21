/**
 * Live updates over Pusher. Each workspace has a private channel its members' browsers subscribe
 * to; the API signs a subscription only for a member. Publishing is best effort: a note is saved
 * whether or not the live update gets out, and a page that missed one sees the note on its next
 * load. A retried trigger can deliver an event twice, so the page keys notes by id.
 */
import { Hono } from "hono"
import Pusher from "pusher"
import { z } from "zod"

import { describe, retrying } from "../shared/retry.ts"
import { membershipOf, type SignedIn, signedIn } from "./session.ts"
import { settings } from "./settings.ts"

const pusher = new Pusher({
  appId: settings.PUSHER_APP_ID,
  key: settings.PUSHER_KEY,
  secret: settings.PUSHER_SECRET,
  cluster: settings.PUSHER_CLUSTER,
  useTLS: true,
  timeout: 5_000,
})

/** The private channel a workspace's live updates go out on. */
export function channelOf(workspaceId: string): string {
  return `private-workspace-${workspaceId}`
}

/** A failed trigger worth repeating: a 429, a 5xx, or no answer at all. */
function retryable(error: unknown): boolean {
  const status: unknown = Reflect.get(Object(error), "status")

  return typeof status !== "number" || status === 429 || status >= 500
}

/** Sends `event` to a workspace's members, retrying briefly; logs, never throws. */
export async function broadcast(workspaceId: string, event: string, data: unknown): Promise<void> {
  try {
    await retrying(
      { name: `pusher ${event}`, attempts: 4, retryable, delayMs: (n) => 200 * n },
      () => pusher.trigger(channelOf(workspaceId), event, data),
    )
  } catch (error) {
    console.warn(`pusher ${event}: not delivered (${describe(error)})`)
  }
}

const Subscribe = z.object({ socket_id: z.string(), channel_name: z.string() })

export const realtimeApi = new Hono<SignedIn>().use(signedIn).post("/realtime/auth", async (c) => {
  const { socket_id, channel_name } = Subscribe.parse(await c.req.json())
  const workspaceId = /^private-workspace-([0-9a-f-]{36})$/.exec(channel_name)?.[1]

  if (!workspaceId) return c.json({ error: "No such channel." }, 403)

  await membershipOf(c.var.userId, workspaceId)

  return c.json(pusher.authorizeChannel(socket_id, channel_name))
})
