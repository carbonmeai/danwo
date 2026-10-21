import { query, transaction } from "./db.ts"
import type { SupportMessage } from "./messages.ts"

/** A conversation as the sidebar lists it. */
export interface Conversation {
  readonly id: string
  readonly title: string
}

/** A conversation id as the page makes them: letters, digits, `_` and `-`. */
export const CONVERSATION_ID = /^[A-Za-z0-9_-]{8,64}$/

/** The first words of what the customer asked, as the conversation's title. */
function titleOf(message: SupportMessage): string {
  const text = message.parts
    .flatMap((part) => (part.type === "text" ? [part.text] : []))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim()

  return text.length > 60 ? `${text.slice(0, 57)}…` : text || "New conversation"
}

/** The most recent conversations, newest first. */
export async function recentConversations(limit = 12): Promise<Conversation[]> {
  return query<Conversation>(
    "select id, title from conversations order by created_at desc, id limit $1",
    [limit],
  )
}

/** Conversation `id`'s messages in order; none for a conversation not saved yet. */
export async function loadMessages(id: string): Promise<SupportMessage[]> {
  const rows = await query<{ message: SupportMessage }>(
    "select message from messages where conversation_id = $1 order by position",
    [id],
  )

  return rows.map((row) => row.message)
}

/**
 * Makes conversation `id` hold exactly `messages`, in order: the conversation is created on its
 * first message, every message is written at its place, and any after the last are removed (the
 * answer a regenerate replaces). It writes the whole list each time, so a retry after a lost
 * answer, or two saves of the same list, leave the same rows.
 */
export async function saveMessages(id: string, messages: readonly SupportMessage[]): Promise<void> {
  const first = messages[0]

  if (first === undefined) return

  await transaction(async (client) => {
    await client.query(
      "insert into conversations (id, title) values ($1, $2) on conflict (id) do nothing",
      [id, titleOf(first)],
    )
    await client.query("delete from messages where conversation_id = $1 and position >= $2", [
      id,
      messages.length,
    ])

    for (const [position, message] of messages.entries())
      await client.query(
        `insert into messages (conversation_id, position, id, role, message)
         values ($1, $2, $3, $4, $5)
         on conflict (conversation_id, position)
         do update set id = excluded.id, role = excluded.role, message = excluded.message`,
        [id, position, message.id, message.role, JSON.stringify(message)],
      )
  })
}
