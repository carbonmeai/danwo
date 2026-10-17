import type {
  AppRecord,
  ChannelRecord,
  InstallationRecord,
  MessageRecord,
  TeamRecord,
  UserRecord,
} from "./entities.ts"
import { SlackApiError, slackId } from "./helpers.ts"
import type { SlackStore } from "./store.ts"

/** The workspace every emulator serves exactly one of; a default one until a seed names it. */
export function teamOf(slack: SlackStore): TeamRecord {
  return (
    slack.teams.all()[0] ??
    slack.teams.insert({ teamId: slackId("T"), name: "Danwo", domain: "danwo" })
  )
}

/** A member by id, email or name, or undefined. */
export function findUser(slack: SlackStore, key: string): UserRecord | undefined {
  return (
    slack.users.findOneBy("userId", key) ??
    slack.users.findOneBy("email", key) ??
    slack.users.all().find((user) => user.name === key)
  )
}

/** A member by id, or Slack's `user_not_found`. */
export function requireUser(slack: SlackStore, userId: string): UserRecord {
  const user = slack.users.findOneBy("userId", userId)

  if (!user || user.deleted) throw new SlackApiError("user_not_found")

  return user
}

/** A conversation by id, or by name with or without `#`. */
export function findChannel(slack: SlackStore, key: string): ChannelRecord | undefined {
  return (
    slack.channels.findOneBy("channelId", key) ??
    slack.channels.findOneBy("name", key.replace(/^#/, ""))
  )
}

/** A conversation the caller named, or Slack's `channel_not_found`. */
export function requireChannel(slack: SlackStore, key: string | undefined): ChannelRecord {
  const channel = key === undefined ? undefined : findChannel(slack, key)

  if (!channel) throw new SlackApiError("channel_not_found")

  return channel
}

/** Refuses a caller who is not a member of `channel`. */
export function requireMember(channel: ChannelRecord, userId: string): void {
  if (!channel.members.includes(userId)) throw new SlackApiError("not_in_channel")
}

/** A message by channel and `ts`, or Slack's `message_not_found`. */
export function requireMessage(slack: SlackStore, channel: string, ts: string | undefined) {
  const message = slack.messages
    .findBy("channel", channel)
    .find((candidate: MessageRecord) => candidate.ts === ts)

  if (!message) throw new SlackApiError("message_not_found")

  return message
}

/** An app by id, with its installation once it is installed. */
export function appOf(
  slack: SlackStore,
  appId: string,
): { app: AppRecord | undefined; install: InstallationRecord | undefined } {
  return {
    app: slack.apps.findOneBy("appId", appId),
    install: slack.installations.findOneBy("appId", appId),
  }
}
