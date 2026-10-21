/**
 * Posting a published note to its workspace's Slack channel, once. Slack has no idempotency key,
 * so a post whose answer was lost looks like a failure while the message is in the channel. Before
 * posting, the job looks for its note's link among the channel's recent messages: a retry that
 * finds it records that message instead of posting again.
 */
import { and, eq } from "drizzle-orm"
import { NonRetriableError, RetryAfterError } from "inngest"

import { broken } from "../shared/bugs.ts"
import { query } from "../shared/db/client.ts"
import { integrations, notes, slackPosts, users } from "../shared/db/schema.ts"
import { DISCONNECTED, slackClient, slackError } from "../shared/slack.ts"
import { settings } from "./settings.ts"

/** The page a note's Slack message links to: also how a retry recognises the message. */
export function noteUrl(workspaceId: string, noteId: number): string {
  return `${settings.WEB_URL}/w/${workspaceId}/notes/${noteId}`
}

/** A Slack failure, as Inngest should treat it: wait and retry, retry, or stop. */
async function failure(error: unknown, workspaceId: string): Promise<never> {
  const code = slackError(error)

  /* Wait as long as Slack asked: retrying sooner only stretches the limit. */
  if (code === "ratelimited") {
    const seconds = Number(Reflect.get(Object(error), "retryAfter") ?? 1)

    throw new RetryAfterError("slack is rate limiting", `${Math.max(1, seconds)}s`)
  }
  if (code !== undefined && (DISCONNECTED.has(code) || code === "channel_not_found")) {
    /* The connection is gone: say so on the integrations page, and stop trying. */
    await query("mark slack disconnected", (db) =>
      db
        .update(integrations)
        .set({ status: "needs_attention" })
        .where(and(eq(integrations.workspaceId, workspaceId), eq(integrations.provider, "slack"))),
    )
    throw new NonRetriableError(`slack: ${code}`)
  }

  throw error instanceof Error ? error : new Error(String(error))
}

/** Posts note `noteId` to Slack unless it is posted already; what happened. */
export async function postNote(noteId: number): Promise<string> {
  const [row] = await query("read note to post", (db) =>
    db
      .select({ note: notes, author: users.name, posted: slackPosts.ts })
      .from(notes)
      .innerJoin(users, eq(users.id, notes.authorId))
      .leftJoin(slackPosts, eq(slackPosts.noteId, notes.id))
      .where(eq(notes.id, noteId)),
  )

  if (!row?.note.publishedAt) return "not published"
  if (row.posted) return `already posted as ${row.posted}`

  const { note } = row
  const [slack] = await query("read slack integration", (db) =>
    db
      .select()
      .from(integrations)
      .where(
        and(eq(integrations.workspaceId, note.workspaceId), eq(integrations.provider, "slack")),
      ),
  )

  if (!slack || slack.status !== "connected" || !slack.channelId) return "slack not connected"

  const client = slackClient(slack.accessToken)
  const channel = slack.channelId
  const url = noteUrl(note.workspaceId, note.id)
  const record = (ts: string) =>
    query("note slack post", (db) =>
      db.insert(slackPosts).values({ noteId, channelId: channel, ts }).onConflictDoNothing(),
    )

  if (!broken("no-slack-dedupe")) {
    const history = await client.conversations
      .history({ channel, limit: 50 })
      .catch((error: unknown) => failure(error, note.workspaceId))
    const earlier = history.messages?.find((message) => message.text?.includes(url))

    if (earlier?.ts) {
      await record(earlier.ts)

      return `found an earlier post, ${earlier.ts}`
    }
  }

  const excerpt = note.body.length > 280 ? `${note.body.slice(0, 277)}…` : note.body
  const posted = await client.chat
    .postMessage({
      channel,
      text: `*${note.title}* by ${row.author ?? "a teammate"}\n${excerpt}\n<${url}|Open in Relay>`,
      unfurl_links: false,
    })
    .catch((error: unknown) => failure(error, note.workspaceId))

  if (!posted.ts) throw new Error("slack answered without a message")

  await record(posted.ts)

  return `posted ${posted.ts}`
}
