import type { Emulator } from "../define.ts"
import type { SlackState } from "./context.ts"
import type { EphemeralRecord, MessageRecord, UserRecord } from "./entities.ts"
import { SlackEvents } from "./events.ts"
import { SlackApiError } from "./helpers.ts"
import { uninstallApp } from "./install.ts"
import { type Action, clickAction, closeView, runCommand, submitView } from "./interactions.ts"
import { appOf, findChannel, findUser, requireMessage } from "./lookup.ts"
import { postMessage } from "./posting.ts"
import { releaseScheduled } from "./routes/chat.ts"
import { addMember, convertChannel, removeMember } from "./routes/conversations.ts"
import { applyReaction } from "./routes/reactions.ts"
import { slackSignature } from "./signature.ts"
import { slackStore } from "./store.ts"

/** A message as a test reads it. */
export interface SlackMessage {
  readonly ts: string
  readonly user: string
  readonly botId: string | null
  readonly text: string
  readonly threadTs: string | null
  readonly blocks: unknown[] | null
  readonly reactions: readonly { readonly name: string; readonly users: readonly string[] }[]
  readonly files: readonly { readonly id: string; readonly name: string }[]
}

/** An ephemeral message as a test reads it. */
export interface SlackEphemeral {
  readonly ts: string
  readonly user: string
  readonly text: string
}

/** The answer an app gave to the Events API's `url_verification` challenge. */
export interface UrlVerification {
  readonly ok: boolean
  readonly status: number
}

/**
 * The workspace from a test's side: what apps posted, and members' actions that apps get told
 * about. Members, channels and messages are named by id, email or name, and `#channel` or id.
 */
export interface SlackWorkspace {
  /** Every message in a channel, thread replies included, oldest first. */
  messages(channel: string): SlackMessage[]
  /** A thread: its parent, then the replies. */
  thread(channel: string, ts: string): SlackMessage[]
  /** Ephemeral messages in a channel, for one member when given. */
  ephemeral(channel: string, user?: string): SlackEphemeral[]
  /**
   * The views apps opened or published that are still open, for one member when given; a modal the
   * app answered with block errors carries them as `errors`.
   */
  views(user?: string): Record<string, unknown>[]
  /** An uploaded file's bytes. */
  file(fileId: string): Buffer | undefined
  /** Posts as a member; apps in the channel get `message` (and `app_mention` when mentioned). */
  post(user: string, channel: string, text: string, options?: { threadTs?: string }): string
  /** Reacts to a message as a member: `reaction_added`. */
  react(user: string, channel: string, ts: string, name: string): void
  /** Adds a member to a channel: `member_joined_channel`. */
  join(user: string, channel: string): void
  /**
   * Takes a member out of a channel, by their own choice or `by`'s: `member_left_channel`, and
   * `channel_left` or `group_left` when the member is an app's bot user.
   */
  leave(user: string, channel: string, by?: string): void
  /** An admin makes a channel private or public: the `channel_convert_to_*` message. */
  convert(admin: string, channel: string, to: "private" | "public"): void
  /** An admin removes an app from the workspace: its tokens go, then `app_uninstalled`. */
  uninstall(appId?: string): void
  /** Runs a slash command as a member. */
  command(user: string, channel: string, command: string, text?: string): void
  /** Clicks a button on an app's message: `block_actions`. */
  click(user: string, channel: string, ts: string, action: Action): void
  /** Submits an open modal with its input values: `view_submission`. */
  submit(user: string, viewId: string, values: Readonly<Record<string, unknown>>): void
  /** Closes an open modal and its stack: `view_closed` when the view asked to be told. */
  close(user: string, viewId: string): void
  /** Sends the Events API's `url_verification` challenge to an app's request URL. */
  verifyEventsUrl(appId?: string): Promise<UrlVerification>
}

function asMessage(message: MessageRecord): SlackMessage {
  return {
    ts: message.ts,
    user: message.user,
    botId: message.botId,
    text: message.text,
    threadTs: message.threadTs,
    blocks: message.blocks,
    reactions: message.reactions,
    files: message.files,
  }
}

const asEphemeral = (message: EphemeralRecord): SlackEphemeral => ({
  ts: message.ts,
  user: message.user,
  text: message.text,
})

/** Sends `url_verification` to an app's events URL and checks it echoes the challenge. */
async function verify(state: SlackState, appId: string | undefined): Promise<UrlVerification> {
  const { slack, clock } = state
  const app =
    appId === undefined
      ? slack.apps.all().find((a) => a.eventsUrl !== null)
      : appOf(slack, appId).app

  if (!app?.eventsUrl) throw new Error("no app with an events URL")

  const challenge = `challenge_${clock().getTime()}`
  const body = JSON.stringify({ token: app.verificationToken, challenge, type: "url_verification" })
  const timestamp = Math.floor(clock().getTime() / 1000)
  const response = await fetch(app.eventsUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-slack-request-timestamp": String(timestamp),
      "x-slack-signature": slackSignature(app.signingSecret, timestamp, body),
    },
    body,
  })
  const text = await response.text()

  return { ok: response.ok && text.includes(challenge), status: response.status }
}

/** The workspace of a Slack emulator, for tests. */
export function slackWorkspace(emulator: Pick<Emulator, "store" | "outbox">): SlackWorkspace {
  const slack = slackStore(emulator.store)
  const clock = emulator.store.clock
  const state: SlackState = {
    store: emulator.store,
    slack,
    clock,
    events: new SlackEvents(slack, emulator.outbox, clock),
  }

  const member = (key: string): UserRecord => {
    const user = findUser(slack, key)

    if (!user) throw new SlackApiError("user_not_found")

    return user
  }

  const channel = (key: string) => {
    const found = findChannel(slack, key)

    if (!found) throw new SlackApiError("channel_not_found")

    return found
  }

  const messagesIn = (key: string) => {
    releaseScheduled(state)

    return slack.messages.findBy("channel", channel(key).channelId)
  }

  return {
    messages: (key) => messagesIn(key).map(asMessage),
    thread: (key, ts) =>
      messagesIn(key)
        .filter((message) => message.ts === ts || message.threadTs === ts)
        .map(asMessage),
    ephemeral: (key, user) =>
      slack.ephemeral
        .findBy("channel", channel(key).channelId)
        .filter((message) => user === undefined || message.user === member(user).userId)
        .map(asEphemeral),
    views: (user) =>
      slack.views
        .all()
        .filter((view) => !view.closed)
        .filter((view) => user === undefined || view.user === member(user).userId)
        .map((view) => ({
          ...view.view,
          id: view.viewId,
          ...(view.errors !== null && { errors: view.errors }),
        })),
    file: (fileId) => {
      const content = slack.files.findOneBy("fileId", fileId)?.content

      return content === null || content === undefined ? undefined : Buffer.from(content, "base64")
    },
    post: (user, key, text, options = {}) => {
      const author = { user: member(user).userId, botId: null, appId: null }
      const draft = { text, threadTs: options.threadTs ?? null }

      return postMessage(state, channel(key), author, draft).ts
    },
    react: (user, key, ts, name) => {
      const target = channel(key)
      const message = requireMessage(slack, target.channelId, ts)

      applyReaction(state, { channel: target, message, user: member(user).userId, name, add: true })
    },
    join: (user, key) => {
      const target = channel(key)
      const id = member(user).userId

      if (!target.members.includes(id)) addMember(state, target, id, null)
    },
    leave: (user, key, by) => {
      const target = channel(key)
      const id = member(user).userId

      if (target.members.includes(id))
        removeMember(state, target, id, by === undefined ? id : member(by).userId)
    },
    convert: (admin, key, to) =>
      void convertChannel(
        state,
        channel(key),
        to === "private" ? "group" : "channel",
        member(admin).userId,
      ),
    uninstall: (appId) => {
      const install =
        appId === undefined ? slack.installations.all()[0] : appOf(slack, appId).install

      if (!install) throw new SlackApiError("app_not_installed")
      uninstallApp(slack, state.events, install.appId)
    },
    command: (user, key, command, text = "") =>
      runCommand(state, member(user), channel(key), command, text),
    click: (user, key, ts, action) => {
      const target = channel(key)

      clickAction(state, member(user), target, requireMessage(slack, target.channelId, ts), action)
    },
    submit: (user, viewId, values) => {
      const view = slack.views.findOneBy("viewId", viewId)

      if (!view) throw new SlackApiError("not_found")
      submitView(state, member(user), view, values)
    },
    close: (user, viewId) => {
      const view = slack.views.findOneBy("viewId", viewId)

      if (!view) throw new SlackApiError("not_found")
      closeView(state, member(user), view)
    },
    verifyEventsUrl: (appId) => verify(state, appId),
  }
}
