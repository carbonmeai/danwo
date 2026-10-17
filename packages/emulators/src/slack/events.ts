import type { Outbox } from "../outbox.ts"
import type { Clock } from "../store.ts"
import type {
  AppRecord,
  ChannelKind,
  ChannelRecord,
  InstallationRecord,
  MessageRecord,
} from "./entities.ts"
import { slackId, unixNow } from "./helpers.ts"
import { appOf, teamOf } from "./lookup.ts"
import type { SlackStore } from "./store.ts"

/** The dispatcher topics: one per app and kind of delivery. */
export const topics = {
  events: (appId: string) => `events:${appId}`,
  interactivity: (appId: string) => `interactivity:${appId}`,
  command: (appId: string, command: string) => `command:${appId}:${command}`,
}

/** The bot scope an event subscription needs, by subscription name. */
const EVENT_SCOPES: Readonly<Record<string, string | null>> = {
  "message.channels": "channels:history",
  "message.groups": "groups:history",
  "message.im": "im:history",
  "message.mpim": "mpim:history",
  app_mention: "app_mentions:read",
  reaction_added: "reactions:read",
  reaction_removed: "reactions:read",
  member_joined_channel: "channels:read",
  tokens_revoked: null,
  app_uninstalled: null,
}

/** The `message.*` subscription that covers each kind of conversation. */
const MESSAGE_SUBSCRIPTION: Readonly<Record<ChannelKind, string>> = {
  channel: "message.channels",
  group: "message.groups",
  im: "message.im",
  mpim: "message.mpim",
}

/** An installed app and its configuration, as event delivery needs them. */
interface Subscriber {
  readonly app: AppRecord
  readonly install: InstallationRecord
}

/** Whether `subscriber` asked for `subscription` and was granted the scope it needs. */
function subscribes(subscriber: Subscriber, subscription: string): boolean {
  const scope = EVENT_SCOPES[subscription]

  return (
    subscriber.app.eventsUrl !== null &&
    subscriber.app.botEvents.includes(subscription) &&
    (scope === null || scope === undefined || subscriber.install.botScopes.includes(scope))
  )
}

/** The fields a message event carries. */
function messageEvent(message: MessageRecord, channel: ChannelRecord, team: string) {
  return {
    type: "message",
    channel: channel.channelId,
    user: message.user,
    text: message.text,
    ts: message.ts,
    event_ts: message.ts,
    channel_type: channel.kind,
    team,
    ...(message.blocks !== null && { blocks: message.blocks }),
    ...(message.threadTs !== null && { thread_ts: message.threadTs }),
    ...(message.botId !== null && { bot_id: message.botId }),
    ...(message.appId !== null && { app_id: message.appId }),
    ...(message.files.length > 0 && { files: message.files, subtype: "file_share" }),
  }
}

/**
 * Queues what Slack sends to apps: Events API callbacks to each installed app that subscribed to
 * the event and holds its scope, slash commands, and interactive payloads. Delivery, signing and
 * retries are the webhook dispatcher's.
 */
export class SlackEvents {
  private readonly queue: { slack: SlackStore; outbox: Outbox; clock: Clock }

  constructor(slack: SlackStore, outbox: Outbox, clock: Clock) {
    this.queue = { slack, outbox, clock }
  }

  private get slack(): SlackStore {
    return this.queue.slack
  }

  /** A new message: `message.*` to members subscribed to the channel's kind, `app_mention` to mentioned bots. */
  message(message: MessageRecord, channel: ChannelRecord): void {
    const team = teamOf(this.slack).teamId
    const event = messageEvent(message, channel, team)

    for (const subscriber of this.inChannel(channel)) {
      if (subscribes(subscriber, MESSAGE_SUBSCRIPTION[channel.kind]))
        this.callback(subscriber, event)
      if (
        subscribes(subscriber, "app_mention") &&
        message.text.includes(`<@${subscriber.install.botUserId}>`)
      )
        this.callback(subscriber, { ...event, type: "app_mention", channel_type: undefined })
    }
  }

  /** An edit or deletion, as the `message_changed` and `message_deleted` subtypes. */
  // fallow-ignore-next-line unused-class-member -- called through a destructured route context
  messageChanged(
    channel: ChannelRecord,
    subtype: "message_changed" | "message_deleted",
    previous: MessageRecord,
    current: MessageRecord | null,
  ): void {
    const team = teamOf(this.slack).teamId
    const event = {
      type: "message",
      subtype,
      hidden: true,
      channel: channel.channelId,
      channel_type: channel.kind,
      ts: current?.editedTs ?? previous.ts,
      event_ts: current?.editedTs ?? previous.ts,
      previous_message: messageEvent(previous, channel, team),
      ...(current === null
        ? { deleted_ts: previous.ts }
        : { message: messageEvent(current, channel, team) }),
    }

    for (const subscriber of this.inChannel(channel))
      if (subscribes(subscriber, MESSAGE_SUBSCRIPTION[channel.kind]))
        this.callback(subscriber, event)
  }

  /** `reaction_added` or `reaction_removed` on a message. */
  reaction(
    type: "reaction_added" | "reaction_removed",
    user: string,
    reaction: string,
    message: MessageRecord,
    channel: ChannelRecord,
  ): void {
    const event = {
      type,
      user,
      reaction,
      item_user: message.user,
      item: { type: "message", channel: channel.channelId, ts: message.ts },
      event_ts: this.eventTs(),
    }

    for (const subscriber of this.inChannel(channel))
      if (subscribes(subscriber, type)) this.callback(subscriber, event)
  }

  /** `member_joined_channel`, to apps in the channel (the joining bot included). */
  memberJoined(user: string, channel: ChannelRecord, inviter: string | null): void {
    const event = {
      type: "member_joined_channel",
      user,
      channel: channel.channelId,
      channel_type: channel.kind === "channel" ? "C" : "G",
      team: teamOf(this.slack).teamId,
      event_ts: this.eventTs(),
      ...(inviter !== null && { inviter }),
    }

    for (const subscriber of this.inChannel(channel))
      if (subscribes(subscriber, "member_joined_channel")) this.callback(subscriber, event)
  }

  /** `tokens_revoked` to the app whose tokens went. */
  // fallow-ignore-next-line unused-class-member -- called through a destructured route context
  tokensRevoked(appId: string, tokens: { oauth: string[]; bot: string[] }): void {
    const subscriber = this.subscriber(appId)

    if (subscriber && subscribes(subscriber, "tokens_revoked"))
      this.callback(subscriber, { type: "tokens_revoked", tokens, event_ts: this.eventTs() })
  }

  /** A slash command, as the form Slack posts to the command's URL. */
  command(appId: string, command: string, fields: Record<string, string>): void {
    this.queue.outbox.push(topics.command(appId, command), new URLSearchParams(fields).toString())
  }

  /** An interactive payload (`block_actions`, `view_submission`), as the `payload` form field. */
  interaction(appId: string, payload: Record<string, unknown>): void {
    const body = new URLSearchParams({ payload: JSON.stringify(payload) }).toString()

    this.queue.outbox.push(topics.interactivity(appId), body)
  }

  private eventTs(): string {
    return `${unixNow(this.queue.clock)}.000000`
  }

  private subscriber(appId: string): Subscriber | undefined {
    const { app, install } = appOf(this.slack, appId)

    return app && install ? { app, install } : undefined
  }

  /** Installed apps whose bot is a member of `channel`. */
  private inChannel(channel: ChannelRecord): Subscriber[] {
    return this.slack.installations
      .all()
      .filter((install) => channel.members.includes(install.botUserId))
      .flatMap((install) => {
        const app = appOf(this.slack, install.appId).app

        return app ? [{ app, install }] : []
      })
  }

  /** Queues an Events API `event_callback` envelope for one app. */
  private callback(subscriber: Subscriber, event: Readonly<Record<string, unknown>>): void {
    const team = teamOf(this.slack).teamId

    this.queue.outbox.push(topics.events(subscriber.app.appId), {
      token: subscriber.app.verificationToken,
      team_id: team,
      api_app_id: subscriber.app.appId,
      event,
      type: "event_callback",
      event_id: slackId("Ev"),
      event_time: unixNow(this.queue.clock),
      authorizations: [
        {
          enterprise_id: null,
          team_id: team,
          user_id: subscriber.install.botUserId,
          is_bot: true,
          is_enterprise_install: false,
        },
      ],
      is_ext_shared_channel: false,
    })
  }
}
