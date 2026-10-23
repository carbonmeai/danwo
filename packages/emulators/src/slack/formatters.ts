import type {
  ConversationsHistoryResponse,
  ConversationsInfoResponse,
  UsersInfoResponse,
} from "@slack/web-api"

import type {
  ChannelRecord,
  FileRecord,
  MessageRecord,
  TeamRecord,
  UserRecord,
  ViewRecord,
} from "./entities.ts"

type User = NonNullable<UsersInfoResponse["user"]>
type Channel = NonNullable<ConversationsInfoResponse["channel"]>
type MessageElement = NonNullable<ConversationsHistoryResponse["messages"]>[number]

const seconds = (iso: string) => Math.floor(new Date(iso).getTime() / 1000)

/**
 * A member as `users.info` and `users.list` show it; the email only with `users:read.email`. A
 * member from another workspace carries that workspace's id.
 */
export function userObject(user: UserRecord, team: TeamRecord, showEmail: boolean) {
  const [first = "", ...rest] = user.realName.split(" ")
  const teamId = user.teamId ?? team.teamId

  return {
    id: user.userId,
    team_id: teamId,
    name: user.name,
    deleted: user.deleted,
    real_name: user.realName,
    tz: "Europe/London",
    tz_label: "Greenwich Mean Time",
    tz_offset: 0,
    is_admin: user.isAdmin,
    is_owner: user.isAdmin,
    is_bot: user.isBot,
    is_app_user: false,
    is_stranger: user.isStranger,
    updated: seconds(user.updated_at),
    profile: {
      real_name: user.realName,
      display_name: user.isBot ? "" : user.name,
      first_name: first,
      last_name: rest.join(" "),
      team: teamId,
      ...(showEmail && user.email !== null && { email: user.email }),
      ...(user.botId !== null && { bot_id: user.botId }),
      ...(user.appId !== null && { api_app_id: user.appId }),
    },
  } satisfies User
}

/** A conversation as `conversations.info` and `conversations.list` show it to `viewer`. */
export function channelObject(channel: ChannelRecord, viewer: string) {
  const isChannel = channel.kind === "channel" || channel.kind === "group"
  const purpose = { value: channel.purpose, creator: channel.creator, last_set: 0 }

  return {
    id: channel.channelId,
    created: seconds(channel.created_at),
    creator: channel.creator,
    is_channel: isChannel,
    is_group: false,
    is_im: channel.kind === "im",
    is_mpim: channel.kind === "mpim",
    is_private: channel.kind !== "channel",
    is_archived: channel.archived,
    is_general: channel.name === "general",
    is_shared: channel.extShared,
    is_ext_shared: channel.extShared,
    is_org_shared: false,
    is_member: channel.members.includes(viewer),
    updated: seconds(channel.updated_at),
    ...(isChannel && {
      name: channel.name,
      name_normalized: channel.name,
      num_members: channel.members.length,
      topic: { ...purpose, value: channel.topic },
      purpose,
    }),
  } satisfies Channel
}

/** A message as history, replies and `chat.*` answers show it. */
export function messageObject(
  message: MessageRecord,
  team: string,
  replies: readonly MessageRecord[] = [],
) {
  const base = {
    type: "message",
    ts: message.ts,
    user: message.user,
    text: message.text,
    team,
    ...(message.botId !== null && { bot_id: message.botId }),
    ...(message.appId !== null && { app_id: message.appId }),
    ...(message.subtype !== null && { subtype: message.subtype }),
    ...(message.threadTs !== null && { thread_ts: message.threadTs }),
    ...(message.editedTs !== null && { edited: { user: message.user, ts: message.editedTs } }),
    ...(message.reactions.length > 0 && {
      reactions: message.reactions.map((r) => ({ ...r, count: r.users.length })),
    }),
    ...threadSummary(replies),
  } satisfies MessageElement

  return {
    ...base,
    ...(message.blocks !== null && { blocks: message.blocks }),
    ...(message.attachments !== null && { attachments: message.attachments }),
    ...(message.files.length > 0 && { files: message.files }),
  }
}

/** The reply counts a thread parent carries. */
function threadSummary(replies: readonly MessageRecord[]) {
  const last = replies.at(-1)

  if (last === undefined) return {}

  const users = [...new Set(replies.map((reply) => reply.user))]

  return {
    reply_count: replies.length,
    reply_users: users,
    reply_users_count: users.length,
    latest_reply: last.ts,
  }
}

/** A view as `views.open`, `views.update` and `views.publish` answer it. */
export function viewObject(view: ViewRecord, team: string, botId: string) {
  return {
    ...view.view,
    id: view.viewId,
    team_id: team,
    app_id: view.appId,
    bot_id: botId,
    hash: view.hash,
    external_id: view.externalId ?? "",
    root_view_id: view.rootViewId ?? view.viewId,
    previous_view_id: view.previousViewId,
    state: { values: {} },
  }
}

/** A file as `files.completeUploadExternal` answers it. */
export function fileObject(file: FileRecord) {
  return { id: file.fileId, title: file.title, name: file.name, size: file.length }
}
