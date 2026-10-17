import type { Store } from "../store.ts"
import type { ChannelRecord, MessageRecord, SharedFile, TokenRecord } from "./entities.ts"
import type { SlackEvents } from "./events.ts"
import { nextTs, SlackApiError } from "./helpers.ts"
import { appOf } from "./lookup.ts"
import type { SlackStore } from "./store.ts"

/** What posting needs from the emulator. */
export interface PostingContext {
  readonly store: Store
  readonly slack: SlackStore
  readonly events: SlackEvents
}

/** Who a message is from: a member, or an app's bot user. */
export interface Author {
  readonly user: string
  readonly botId: string | null
  readonly appId: string | null
}

/** A message about to be posted. */
export interface Draft {
  readonly text: string
  readonly blocks?: unknown[] | null
  readonly attachments?: unknown[] | null
  readonly threadTs?: string | null
  readonly subtype?: string | null
  readonly files?: SharedFile[]
}

/** Slack's limit on a message's text. */
const MAX_TEXT = 40_000

/** Refuses a draft Slack would: nothing to show, too long, or an archived channel. */
export function checkDraft(channel: ChannelRecord, draft: Draft): void {
  const empty = draft.text === "" && !draft.blocks && !draft.attachments && !draft.files?.length

  if (empty) throw new SlackApiError("no_text")
  if (draft.text.length > MAX_TEXT) throw new SlackApiError("msg_too_long")
  if (channel.archived) throw new SlackApiError("is_archived")
}

/** The author a token posts as: its user, plus the bot and app ids for a bot token. */
export function authorOf(slack: SlackStore, token: TokenRecord): Author {
  if (token.kind === "user") return { user: token.userId, botId: null, appId: null }

  return {
    user: token.userId,
    botId: appOf(slack, token.appId).install?.botId ?? null,
    appId: token.appId,
  }
}

/** The bot author of an installed app. */
export function botAuthor(slack: SlackStore, appId: string): Author {
  const install = appOf(slack, appId).install

  if (!install) throw new SlackApiError("account_inactive")

  return { user: install.botUserId, botId: install.botId, appId }
}

/** Stores a message and tells subscribed apps about it. */
export function postMessage(
  context: PostingContext,
  channel: ChannelRecord,
  author: Author,
  draft: Draft,
): MessageRecord {
  checkDraft(channel, draft)

  const message = context.slack.messages.insert({
    channel: channel.channelId,
    ts: nextTs(context.store),
    ...author,
    text: draft.text,
    blocks: draft.blocks ?? null,
    attachments: draft.attachments ?? null,
    threadTs: draft.threadTs ?? null,
    subtype: draft.subtype ?? null,
    editedTs: null,
    reactions: [],
    files: draft.files ?? [],
  })

  context.events.message(message, channel)

  return message
}

/** Whether `message` shows in channel history: top-level, a thread parent or a broadcast reply. */
export function isTopLevel(message: MessageRecord): boolean {
  return (
    message.threadTs === null ||
    message.threadTs === message.ts ||
    message.subtype === "thread_broadcast"
  )
}

/** The replies to a thread parent, oldest first. */
export function repliesTo(slack: SlackStore, parent: MessageRecord): MessageRecord[] {
  return slack.messages
    .findBy("channel", parent.channel)
    .filter((message) => message.threadTs === parent.ts && message.ts !== parent.ts)
}
