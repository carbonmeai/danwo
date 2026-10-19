/**
 * A grant's mailbox: messages filed in folders and grouped in threads. Sending files the message
 * in the sender's SENT folder and delivers a copy to every recipient that is also a grant of the
 * application, so two connected accounts can write to each other in a test.
 */
import { asRecord } from "../json.ts"
import type {
  NylasAttachment,
  NylasEmailName,
  NylasGrant,
  NylasMessage,
  NylasThread,
} from "./entities.ts"
import { grantForEmail } from "./grants.ts"
import {
  badRequest,
  hexId,
  metadataOf,
  type NylasRouteContext,
  people,
  seconds,
  snippetOf,
  text,
} from "./helpers.ts"

/** A message to file: who it is between and what it says. */
export interface MessageInput {
  readonly subject: string
  readonly body: string
  readonly from: readonly NylasEmailName[]
  readonly to: readonly NylasEmailName[]
  readonly cc?: readonly NylasEmailName[]
  readonly bcc?: readonly NylasEmailName[]
  readonly reply_to?: readonly NylasEmailName[]
  readonly thread_id?: string
  readonly metadata?: Readonly<Record<string, string>>
  readonly attachments?: readonly { filename: string; content_type: string; content: string }[]
}

/** The thread a message joins: the one named, or a new one. */
function threadFor(
  context: NylasRouteContext,
  grant: NylasGrant,
  input: MessageInput,
): NylasThread {
  const named = input.thread_id && context.objects.threads.get(input.thread_id)

  if (named && named.grant_id === grant.id) return named

  const now = seconds(context.clock)

  return context.objects.threads.add(
    {
      id: hexId(),
      grant_id: grant.id,
      object: "thread",
      subject: input.subject,
      snippet: "",
      participants: [],
      message_ids: [],
      draft_ids: [],
      folders: [],
      has_attachments: false,
      has_drafts: false,
      starred: false,
      unread: false,
      earliest_message_date: now,
      latest_message_received_date: null,
      latest_message_sent_date: null,
      latest_draft_or_message: null,
    },
    null,
  )
}

/** The thread's summary fields, recomputed from its messages. */
export function refreshThread(context: NylasRouteContext, threadId: string): void {
  const thread = context.objects.threads.get(threadId)

  if (!thread) return

  const messages = context.objects.messages.where((m) => m.thread_id === threadId)
  const latest = messages.at(-1) ?? null
  const seen = new Map<string, NylasEmailName>()

  for (const message of messages)
    for (const person of [...message.from, ...message.to, ...message.cc])
      seen.set(person.email, person)

  context.objects.threads.change(threadId, {
    message_ids: messages.map((m) => m.id),
    participants: [...seen.values()],
    folders: [...new Set(messages.flatMap((m) => m.folders))],
    unread: messages.some((m) => m.unread),
    starred: messages.some((m) => m.starred),
    has_attachments: messages.some((m) => m.attachments.length > 0),
    snippet: latest?.snippet ?? "",
    latest_draft_or_message: latest,
    latest_message_received_date:
      messages.filter((m) => !m.folders.includes("SENT")).at(-1)?.date ?? null,
    latest_message_sent_date:
      messages.filter((m) => m.folders.includes("SENT")).at(-1)?.date ?? null,
  })
}

function attachmentsOf(
  context: NylasRouteContext,
  grant: NylasGrant,
  messageId: string,
  input: MessageInput,
): NylasAttachment[] {
  return (input.attachments ?? []).map((file) => {
    const id = `v0:${Buffer.from(file.filename).toString("base64url")}:${hexId()}`

    context.objects.files.add(
      { id, grant_id: grant.id, message_id: messageId, content: file.content },
      null,
    )

    return {
      id,
      grant_id: grant.id,
      filename: file.filename,
      content_type: file.content_type,
      size: Buffer.from(file.content, "base64").length,
      is_inline: false,
    }
  })
}

/** Files a message in `folder` of `grant`'s mailbox and announces it with `message.created`. */
export function fileMessage(
  context: NylasRouteContext,
  grant: NylasGrant,
  input: MessageInput,
  folder: "INBOX" | "SENT",
): NylasMessage {
  const thread = threadFor(context, grant, input)
  const id = hexId()
  const message: NylasMessage = {
    id,
    grant_id: grant.id,
    object: "message",
    thread_id: thread.id,
    subject: input.subject,
    snippet: snippetOf(input.body),
    body: input.body,
    from: [...input.from],
    to: [...input.to],
    cc: [...(input.cc ?? [])],
    bcc: folder === "SENT" ? [...(input.bcc ?? [])] : [],
    reply_to: [...(input.reply_to ?? [])],
    date: seconds(context.clock),
    unread: folder === "INBOX",
    starred: false,
    folders: [folder],
    attachments: attachmentsOf(context, grant, id, input),
    metadata: { ...input.metadata },
    created_at: seconds(context.clock),
  }

  context.objects.messages.add(message, null)
  refreshThread(context, thread.id)
  context.events.emit("message.created", grant, message)

  return message
}

/** A send request's fields, checked: at least one recipient, a subject or a body. */
export function messageInput(
  grant: NylasGrant,
  body: Readonly<Record<string, unknown>>,
): MessageInput {
  const to = people(body["to"])

  if (to.length === 0 && people(body["cc"]).length === 0 && people(body["bcc"]).length === 0)
    throw badRequest("at least one recipient is required in to, cc or bcc")

  const from = people(body["from"])
  const attachments = Array.isArray(body["attachments"]) ? body["attachments"] : []

  return {
    subject: text(body, "subject") ?? "",
    body: text(body, "body") ?? "",
    from:
      from.length > 0 ? from : [{ email: grant.email, ...(grant.name && { name: grant.name }) }],
    to,
    cc: people(body["cc"]),
    bcc: people(body["bcc"]),
    reply_to: people(body["reply_to"]),
    metadata: metadataOf(body["metadata"]),
    attachments: attachments.flatMap((item) => {
      const file = asRecord(item)
      const filename = file?.["filename"]
      const content = file?.["content"]

      return typeof filename === "string" && typeof content === "string"
        ? [
            {
              filename,
              content,
              content_type:
                typeof file?.["content_type"] === "string"
                  ? file["content_type"]
                  : "application/octet-stream",
            },
          ]
        : []
    }),
  }
}

/** Sends `input` from `grant`: filed as sent, and delivered to recipients the application holds. */
export function sendMessage(
  context: NylasRouteContext,
  grant: NylasGrant,
  input: MessageInput,
  replyTo?: NylasMessage,
): NylasMessage {
  const sent = fileMessage(
    context,
    grant,
    { ...input, ...(replyTo && { thread_id: replyTo.thread_id }) },
    "SENT",
  )

  for (const person of [...input.to, ...(input.cc ?? []), ...(input.bcc ?? [])]) {
    const recipient = grantForEmail(context, person.email)

    if (recipient && recipient.id !== grant.id) fileMessage(context, recipient, input, "INBOX")
  }

  return sent
}
