import { requireScope } from "../auth.ts"
import type { ApiCall, Methods } from "../context.ts"
import type { ChannelKind, ChannelRecord, MessageRecord } from "../entities.ts"
import { channelObject, messageObject } from "../formatters.ts"
import {
  flagArg,
  listArg,
  paginate,
  requireArg,
  SlackApiError,
  slackId,
  stringArg,
} from "../helpers.ts"
import { isExternal, requireChannel, requireMessage, requireUser, teamOf } from "../lookup.ts"
import { isTopLevel, type PostingContext, postMessage, repliesTo } from "../posting.ts"

const READ = ["channels:read", "groups:read", "im:read", "mpim:read"]
const HISTORY = ["channels:history", "groups:history", "im:history", "mpim:history"]
const MANAGE = ["channels:manage", "groups:write"]

/** The `types` argument's names for each kind of conversation. */
const TYPE_NAMES: Readonly<Record<string, ChannelKind>> = {
  public_channel: "channel",
  private_channel: "group",
  im: "im",
  mpim: "mpim",
}

/** Whether `viewer` can see `channel`: public channels to all, the rest to their members. */
function canSee(channel: ChannelRecord, viewer: string): boolean {
  return channel.kind === "channel" || channel.members.includes(viewer)
}

/** The conversation a call names, if the caller can see it. */
function visibleChannel(call: ApiCall): ChannelRecord {
  const channel = requireChannel(call.context.slack, stringArg(call.args, "channel"))

  if (!canSee(channel, call.token.userId)) throw new SlackApiError("channel_not_found")

  return channel
}

/** A conversation the caller is a member of, as reading history requires. */
function joinedChannel(call: ApiCall): ChannelRecord {
  const channel = visibleChannel(call)

  if (!channel.members.includes(call.token.userId)) throw new SlackApiError("not_in_channel")

  return channel
}

function listMethod(call: ApiCall) {
  const kinds = listArg(call.args, "types").map((name) => TYPE_NAMES[name])
  const wanted = kinds.length > 0 ? kinds : ["channel"]
  const excludeArchived = flagArg(call.args, "exclude_archived")
  const viewer = call.token.userId
  const channels = call.context.slack.channels
    .all()
    .filter((channel) => wanted.includes(channel.kind) && canSee(channel, viewer))
    .filter((channel) => !(excludeArchived && channel.archived))
  const page = paginate(channels, call.args)

  return {
    channels: page.items.map((channel) => channelObject(channel, viewer)),
    response_metadata: { next_cursor: page.nextCursor },
  }
}

const team = (call: ApiCall) => teamOf(call.context.slack).teamId

/** Messages within the `oldest` and `latest` bounds, honouring `inclusive`. */
function inWindow(call: ApiCall): (message: MessageRecord) => boolean {
  const oldest = Number(stringArg(call.args, "oldest") ?? 0)
  const latest = Number(stringArg(call.args, "latest") ?? Number.POSITIVE_INFINITY)
  const inclusive = flagArg(call.args, "inclusive")

  return (message) => {
    const ts = Number(message.ts)

    return inclusive ? ts >= oldest && ts <= latest : ts > oldest && ts < latest
  }
}

function historyMethod(call: ApiCall) {
  const { slack } = call.context
  const channel = joinedChannel(call)
  const messages = slack.messages
    .findBy("channel", channel.channelId)
    .filter((message) => isTopLevel(message) && inWindow(call)(message))
    .toReversed()
  const page = paginate(messages, call.args)

  return {
    messages: page.items.map((message) =>
      messageObject(message, team(call), repliesTo(slack, message)),
    ),
    has_more: page.nextCursor !== "",
    pin_count: 0,
    response_metadata: { next_cursor: page.nextCursor },
  }
}

function repliesMethod(call: ApiCall) {
  const { slack } = call.context
  const channel = joinedChannel(call)
  const parent = requireMessage(slack, channel.channelId, stringArg(call.args, "ts"))

  if (!isTopLevel(parent)) throw new SlackApiError("thread_not_found")

  const replies = repliesTo(slack, parent)
  const page = paginate([parent, ...replies.filter(inWindow(call))], call.args)

  return {
    messages: page.items.map((message) =>
      messageObject(message, team(call), message === parent ? replies : []),
    ),
    has_more: page.nextCursor !== "",
    response_metadata: { next_cursor: page.nextCursor },
  }
}

function membersMethod(call: ApiCall) {
  const page = paginate(visibleChannel(call).members, call.args)

  return { members: page.items, response_metadata: { next_cursor: page.nextCursor } }
}

/**
 * Adds `user` to `channel` and tells subscribed apps. A member from another workspace makes the
 * channel shared through Slack Connect.
 */
export function addMember(
  context: PostingContext,
  channel: ChannelRecord,
  user: string,
  inviter: string | null,
): ChannelRecord {
  const { slack, events } = context
  const updated =
    slack.channels.update(channel.id, {
      members: [...channel.members, user],
      extShared: channel.extShared || isExternal(slack, user),
    }) ?? channel

  events.memberJoined(user, updated, inviter)

  return updated
}

/** Takes `user` out of `channel`, by their own choice or `actor`'s, and tells subscribed apps. */
export function removeMember(
  context: PostingContext,
  channel: ChannelRecord,
  user: string,
  actor: string,
): ChannelRecord {
  const { slack, events } = context
  const updated =
    slack.channels.update(channel.id, {
      members: channel.members.filter((member) => member !== user),
    }) ?? channel

  events.memberLeft(user, updated, actor)

  return updated
}

/** Refuses to take anyone out of `#general` or a DM, and anyone out of an archived channel. */
function canRemoveFrom(channel: ChannelRecord, generalError: string): void {
  if (channel.kind === "im" || channel.kind === "mpim")
    throw new SlackApiError("method_not_supported_for_channel_type")
  if (channel.name === "general") throw new SlackApiError(generalError)
  if (channel.archived) throw new SlackApiError("is_archived")
}

function leaveMethod(call: ApiCall) {
  const channel = visibleChannel(call)
  const user = call.token.userId

  canRemoveFrom(channel, "cant_leave_general")
  if (!channel.members.includes(user)) return { not_in_channel: true }
  removeMember(call.context, channel, user, user)

  return {}
}

function kickMethod(call: ApiCall) {
  const { slack } = call.context
  const channel = joinedChannel(call)
  const actor = call.token.userId
  const user = requireUser(slack, requireArg(call.args, "user", "user_not_found")).userId

  canRemoveFrom(channel, "cant_kick_from_general")
  if (user === actor) throw new SlackApiError("cant_kick_self")
  if (!channel.members.includes(user)) throw new SlackApiError("not_in_channel")
  removeMember(call.context, channel, user, actor)

  return {}
}

/** The system message Slack posts when a channel changes visibility. */
const CONVERT_SUBTYPE = {
  group: "channel_convert_to_private",
  channel: "channel_convert_to_public",
}

/**
 * Makes a channel private (`group`) or public (`channel`), keeping its id, members and history,
 * and posts the `channel_convert_to_*` message, which tells the apps in it. Only a workspace admin
 * may, with a user token holding `admin.conversations:write`; `#general` stays public.
 */
export function convertChannel(
  context: PostingContext,
  channel: ChannelRecord,
  to: "channel" | "group",
  actor: string,
): ChannelRecord {
  if (channel.kind === "im" || channel.kind === "mpim")
    throw new SlackApiError("method_not_supported_for_channel_type")
  if (channel.name === "general") throw new SlackApiError("default_org_wide_channel")
  if (channel.archived) throw new SlackApiError("is_archived")
  if (channel.kind === to) throw new SlackApiError("could_not_convert_channel")

  const updated = context.slack.channels.update(channel.id, { kind: to }) ?? channel
  const visibility = to === "group" ? "private" : "public"

  postMessage(
    context,
    updated,
    { user: actor, botId: null, appId: null },
    { text: `made this channel ${visibility}`, subtype: CONVERT_SUBTYPE[to] },
  )

  return updated
}

/** `admin.conversations.convertToPrivate` and `convertToPublic`, for a workspace admin. */
function convertMethod(to: "channel" | "group") {
  return (call: ApiCall) => {
    const { slack } = call.context

    if (call.token.kind !== "user") throw new SlackApiError("not_allowed_token_type")
    requireScope(call.token, ["admin.conversations:write"])
    if (!requireUser(slack, call.token.userId).isAdmin) throw new SlackApiError("not_an_admin")

    const channel = requireChannel(slack, requireArg(call.args, "channel_id", "channel_not_found"))

    convertChannel(call.context, channel, to, call.token.userId)

    return {}
  }
}

function joinMethod(call: ApiCall) {
  const channel = requireChannel(call.context.slack, stringArg(call.args, "channel"))
  const viewer = call.token.userId

  if (channel.kind !== "channel") throw new SlackApiError("method_not_supported_for_channel_type")
  if (channel.archived) throw new SlackApiError("is_archived")
  if (channel.members.includes(viewer))
    return { channel: channelObject(channel, viewer), warning: "already_in_channel" }

  return { channel: channelObject(addMember(call.context, channel, viewer, null), viewer) }
}

/** A valid new channel name, or the error Slack answers. */
function newChannelName(call: ApiCall): string {
  const name = requireArg(call.args, "name", "invalid_name_required")

  if (name.length > 80) throw new SlackApiError("invalid_name_maxlength")
  if (!/^[a-z0-9_-]+$/.test(name)) throw new SlackApiError("invalid_name_specials")
  if (call.context.slack.channels.findOneBy("name", name)) throw new SlackApiError("name_taken")

  return name
}

function createMethod(call: ApiCall) {
  const isPrivate = flagArg(call.args, "is_private")

  requireScope(call.token, [isPrivate ? "groups:write" : "channels:manage"])

  const channel = call.context.slack.channels.insert({
    channelId: slackId("C"),
    name: newChannelName(call),
    kind: isPrivate ? "group" : "channel",
    creator: call.token.userId,
    members: [call.token.userId],
    topic: "",
    purpose: "",
    archived: false,
    extShared: false,
  })

  return { channel: channelObject(channel, call.token.userId) }
}

function inviteMethod(call: ApiCall) {
  const { slack } = call.context
  const inviter = call.token.userId
  const channel = joinedChannel(call)
  const users = listArg(call.args, "users").map((id) => requireUser(slack, id).userId)

  if (users.length === 0) throw new SlackApiError("no_user")
  if (users.includes(inviter)) throw new SlackApiError("cant_invite_self")
  if (users.some((user) => channel.members.includes(user)))
    throw new SlackApiError("already_in_channel")

  const updated = users.reduce(
    (current, user) => addMember(call.context, current, user, inviter),
    channel,
  )

  return { channel: channelObject(updated, inviter) }
}

/** The members of a DM or group DM with exactly these people, if one exists. */
function existingDm(call: ApiCall, members: readonly string[]): ChannelRecord | undefined {
  const key = members.toSorted().join(",")

  return call.context.slack.channels
    .all()
    .find(
      (channel) =>
        (channel.kind === "im" || channel.kind === "mpim") &&
        channel.members.toSorted().join(",") === key,
    )
}

function openMethod(call: ApiCall) {
  const { slack } = call.context
  const others = listArg(call.args, "users").map((id) => requireUser(slack, id).userId)

  if (others.length === 0) throw new SlackApiError("users_list_not_supplied")
  if (others.length > 8) throw new SlackApiError("too_many_users")

  const members = [...new Set([call.token.userId, ...others])]
  const found = existingDm(call, members)

  if (found) return { no_op: true, already_open: true, channel: { id: found.channelId } }

  const isGroup = members.length > 2
  const channel = slack.channels.insert({
    channelId: slackId(isGroup ? "C" : "D"),
    name: isGroup ? `mpdm-${members.join("--")}` : (others[0] ?? ""),
    kind: isGroup ? "mpim" : "im",
    creator: call.token.userId,
    members,
    topic: "",
    purpose: "",
    archived: false,
    extShared: false,
  })

  return { channel: { id: channel.channelId } }
}

/** The `conversations.*` methods. */
export const conversationMethods: Methods = {
  "conversations.list": { scopes: READ, run: listMethod },
  "conversations.info": {
    scopes: READ,
    run: (call) => ({ channel: channelObject(visibleChannel(call), call.token.userId) }),
  },
  "conversations.history": { scopes: HISTORY, run: historyMethod },
  "conversations.replies": { scopes: HISTORY, run: repliesMethod },
  "conversations.members": { scopes: READ, run: membersMethod },
  "conversations.join": { scopes: ["channels:join"], run: joinMethod },
  "conversations.create": { scopes: MANAGE, run: createMethod },
  "conversations.invite": { scopes: MANAGE, run: inviteMethod },
  "conversations.open": { scopes: ["im:write", "mpim:write"], run: openMethod },
  "conversations.leave": {
    scopes: ["channels:manage", "channels:write", "groups:write", "im:write", "mpim:write"],
    run: leaveMethod,
  },
  "conversations.kick": { scopes: MANAGE, run: kickMethod },
  "admin.conversations.convertToPrivate": { scopes: [], run: convertMethod("group") },
  "admin.conversations.convertToPublic": { scopes: [], run: convertMethod("channel") },
}
