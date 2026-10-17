import type { ApiCall, Methods, SlackState } from "../context.ts"
import type { ChannelRecord, MessageRecord } from "../entities.ts"
import { messageObject } from "../formatters.ts"
import {
  type Args,
  arrayArg,
  flagArg,
  nextTs,
  requireArg,
  SlackApiError,
  slackId,
  stringArg,
  unixNow,
} from "../helpers.ts"
import { requireChannel, requireMember, requireMessage, requireUser, teamOf } from "../lookup.ts"
import { authorOf, botAuthor, checkDraft, type Draft, postMessage } from "../posting.ts"

const WRITE = ["chat:write", "chat:write:bot", "chat:write:user"]

/** The most a message may be scheduled ahead: 120 days. */
const MAX_SCHEDULE_SECONDS = 120 * 24 * 3600

/** The text, blocks, attachments and thread of a `chat.*` call. */
function draftOf(args: Args): Draft {
  const threadTs = stringArg(args, "thread_ts") ?? null

  return {
    text: stringArg(args, "text") ?? "",
    blocks: arrayArg(args, "blocks"),
    attachments: arrayArg(args, "attachments"),
    threadTs,
    subtype: threadTs !== null && flagArg(args, "reply_broadcast") ? "thread_broadcast" : null,
  }
}

/**
 * The channel a token may post to: a member's channel, or for a bot with `chat:write.public`, any
 * public channel.
 */
function postableChannel(call: ApiCall): ChannelRecord {
  const { slack } = call.context
  const channel = requireChannel(slack, stringArg(call.args, "channel"))
  const isPublic = channel.kind === "channel"

  if (!(isPublic && call.token.scopes.includes("chat:write.public")))
    requireMember(channel, call.token.userId)

  return channel
}

/** A message the caller wrote, for editing or deleting; anyone else's is refused with `error`. */
function ownMessage(
  call: ApiCall,
  error: string,
): { channel: ChannelRecord; message: MessageRecord } {
  const { slack } = call.context
  const channel = requireChannel(slack, stringArg(call.args, "channel"))
  const message = requireMessage(slack, channel.channelId, stringArg(call.args, "ts"))

  if (message.user !== call.token.userId) throw new SlackApiError(error)

  return { channel, message }
}

const team = (call: ApiCall) => teamOf(call.context.slack).teamId

function postMessageMethod(call: ApiCall) {
  const channel = postableChannel(call)
  const message = postMessage(
    call.context,
    channel,
    authorOf(call.context.slack, call.token),
    draftOf(call.args),
  )

  return { channel: channel.channelId, ts: message.ts, message: messageView(call, message) }
}

const messageView = (call: ApiCall, message: MessageRecord) => messageObject(message, team(call))

function updateMethod(call: ApiCall) {
  const { slack, events } = call.context
  const { channel, message } = ownMessage(call, "cant_update_message")
  const draft = draftOf(call.args)
  const changes = {
    text: draft.text === "" ? message.text : draft.text,
    blocks: draft.blocks ?? message.blocks,
    editedTs: nextTs(call.context.store),
  }

  checkDraft(channel, { ...draft, ...changes })

  const updated = slack.messages.update(message.id, changes) ?? message

  events.messageChanged(channel, "message_changed", message, updated)

  return {
    channel: channel.channelId,
    ts: updated.ts,
    text: updated.text,
    message: messageView(call, updated),
  }
}

function deleteMethod(call: ApiCall) {
  const { slack, events } = call.context
  const { channel, message } = ownMessage(call, "cant_delete_message")

  slack.messages.delete(message.id)
  events.messageChanged(channel, "message_deleted", message, null)

  return { channel: channel.channelId, ts: message.ts }
}

function postEphemeralMethod(call: ApiCall) {
  const { slack, store } = call.context
  const channel = postableChannel(call)
  const user = requireUser(slack, requireArg(call.args, "user", "user_not_found"))
  const draft = draftOf(call.args)

  if (!channel.members.includes(user.userId)) throw new SlackApiError("user_not_in_channel")
  checkDraft(channel, draft)

  const ts = nextTs(store)

  slack.ephemeral.insert({
    channel: channel.channelId,
    user: user.userId,
    ts,
    text: draft.text,
    blocks: draft.blocks ?? null,
    appId: call.token.appId,
  })

  return { message_ts: ts }
}

function postAtOf(call: ApiCall): number {
  const postAt = Number(requireArg(call.args, "post_at", "invalid_time"))
  const now = unixNow(call.context.clock)

  if (!Number.isInteger(postAt)) throw new SlackApiError("invalid_time")
  if (postAt <= now) throw new SlackApiError("time_in_past")
  if (postAt > now + MAX_SCHEDULE_SECONDS) throw new SlackApiError("time_too_far")

  return postAt
}

function scheduleMessageMethod(call: ApiCall) {
  const channel = postableChannel(call)
  const draft = draftOf(call.args)
  const postAt = postAtOf(call)

  checkDraft(channel, draft)

  const scheduled = call.context.slack.scheduled.insert({
    scheduledId: slackId("Q"),
    appId: call.token.appId,
    channel: channel.channelId,
    text: draft.text,
    threadTs: draft.threadTs ?? null,
    postAt,
    posted: false,
  })

  return {
    channel: channel.channelId,
    scheduled_message_id: scheduled.scheduledId,
    post_at: postAt,
    message: { type: "message", text: draft.text, user: call.token.userId, team: team(call) },
  }
}

/**
 * Posts every scheduled message whose time has come, as its app's bot. The emulator does this
 * before each Web API call and whenever a test reads the workspace.
 */
export function releaseScheduled(context: SlackState): void {
  const now = unixNow(context.clock)
  const due = context.slack.scheduled.all().filter((item) => !item.posted && item.postAt <= now)

  for (const item of due) {
    context.slack.scheduled.update(item.id, { posted: true })

    const channel = requireChannel(context.slack, item.channel)

    postMessage(context, channel, botAuthor(context.slack, item.appId), {
      text: item.text,
      threadTs: item.threadTs,
    })
  }
}

/** `chat.postMessage`, `chat.update`, `chat.delete`, `chat.postEphemeral`, `chat.scheduleMessage`. */
export const chatMethods: Methods = {
  "chat.postMessage": { scopes: WRITE, run: postMessageMethod },
  "chat.update": { scopes: WRITE, run: updateMethod },
  "chat.delete": { scopes: WRITE, run: deleteMethod },
  "chat.postEphemeral": { scopes: WRITE, run: postEphemeralMethod },
  "chat.scheduleMessage": { scopes: WRITE, run: scheduleMessageMethod },
}
