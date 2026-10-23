import { randomInt } from "node:crypto"

import type { SlackState } from "./context.ts"
import type { AppRecord, ChannelRecord, MessageRecord, UserRecord, ViewRecord } from "./entities.ts"
import { messageObject, viewObject } from "./formatters.ts"
import { SlackApiError, secretHex } from "./helpers.ts"
import { appOf, teamOf } from "./lookup.ts"
import { closeViews, stackOf } from "./modals.ts"
import { issueResponseUrl } from "./routes/webhooks.ts"

/** How long a trigger id lets an app open a modal: three seconds. */
const TRIGGER_MS = 3_000

/** A trigger id for `appId`, good once for `views.open`. */
function issueTrigger(context: SlackState, appId: string, user: string): string {
  const team = teamOf(context.slack).teamId
  const triggerId = `${randomInt(1e12, 1e13)}.${team}.${secretHex(16)}`

  context.slack.triggers.insert({
    triggerId,
    appId,
    user,
    expiresAt: context.clock().getTime() + TRIGGER_MS,
    used: false,
  })

  return triggerId
}

/** The installed app that owns slash command `command`. */
function commandOwner(context: SlackState, command: string): AppRecord {
  const owner = context.slack.installations
    .all()
    .map((install) => appOf(context.slack, install.appId).app)
    .find((app) => app?.commands.some((setting) => setting.command === command))

  if (!owner) throw new SlackApiError("command_not_found")

  return owner
}

/** Runs slash command `command` as `user` in `channel`: Slack's form to the command's URL. */
export function runCommand(
  context: SlackState,
  user: UserRecord,
  channel: ChannelRecord,
  command: string,
  text: string,
): void {
  const app = commandOwner(context, command)
  const team = teamOf(context.slack)
  const fields = {
    appId: app.appId,
    channel: channel.channelId,
    user: user.userId,
    messageTs: null,
  }

  context.events.command(app.appId, command, {
    token: app.verificationToken,
    team_id: team.teamId,
    team_domain: team.domain,
    channel_id: channel.channelId,
    channel_name: channel.name,
    user_id: user.userId,
    user_name: user.name,
    command,
    text,
    api_app_id: app.appId,
    is_enterprise_install: "false",
    response_url: issueResponseUrl(context, fields, "commands"),
    trigger_id: issueTrigger(context, app.appId, user.userId),
  })
}

/** The `user` and `team` objects interactive payloads carry. */
function people(context: SlackState, user: UserRecord) {
  const team = teamOf(context.slack)

  return {
    user: { id: user.userId, username: user.name, name: user.name, team_id: team.teamId },
    team: { id: team.teamId, domain: team.domain },
    is_enterprise_install: false,
  }
}

/** A button or menu choice in a message. */
export interface Action {
  readonly actionId: string
  readonly value?: string
  readonly blockId?: string
}

/** Clicks an interactive element on an app's message: Slack's `block_actions` payload. */
export function clickAction(
  context: SlackState,
  user: UserRecord,
  channel: ChannelRecord,
  message: MessageRecord,
  action: Action,
): void {
  const app = message.appId === null ? undefined : appOf(context.slack, message.appId).app

  if (!app) throw new SlackApiError("not_an_app_message")

  const team = teamOf(context.slack).teamId
  const fields = {
    appId: app.appId,
    channel: channel.channelId,
    user: user.userId,
    messageTs: message.ts,
  }

  context.events.interaction(app.appId, {
    type: "block_actions",
    ...people(context, user),
    api_app_id: app.appId,
    token: app.verificationToken,
    container: {
      type: "message",
      message_ts: message.ts,
      channel_id: channel.channelId,
      is_ephemeral: false,
    },
    trigger_id: issueTrigger(context, app.appId, user.userId),
    channel: { id: channel.channelId, name: channel.name },
    message: messageObject(message, team),
    state: { values: {} },
    response_url: issueResponseUrl(context, fields, "actions"),
    actions: [
      {
        action_id: action.actionId,
        block_id: action.blockId ?? secretHex(3),
        type: "button",
        value: action.value ?? "",
        action_ts: `${Math.floor(context.clock().getTime() / 1000)}.000000`,
      },
    ],
  })
}

/** Submits a modal with `values` (`{ block_id: { action_id: { type, value } } }`): `view_submission`. */
export function submitView(
  context: SlackState,
  user: UserRecord,
  view: ViewRecord,
  values: Readonly<Record<string, unknown>>,
): void {
  const app = appOf(context.slack, view.appId).app

  if (!app) throw new SlackApiError("not_found")

  const team = teamOf(context.slack).teamId
  const shown = viewObject(view, team, appOf(context.slack, app.appId).install?.botId ?? "")

  context.events.interaction(app.appId, {
    type: "view_submission",
    ...people(context, user),
    api_app_id: app.appId,
    token: app.verificationToken,
    trigger_id: issueTrigger(context, app.appId, user.userId),
    view: { ...shown, state: { values } },
    response_urls: [],
  })
}

/**
 * Closes an open modal the way a member does with its close button: the whole stack goes. An app
 * whose view set `notify_on_close` gets `view_closed`, with `is_cleared` when more than one view
 * closed.
 */
export function closeView(context: SlackState, user: UserRecord, view: ViewRecord): void {
  if (view.closed || view.view.type !== "modal" || view.user !== user.userId)
    throw new SlackApiError("not_found")

  const stack = stackOf(context.slack, view)
  const app = appOf(context.slack, view.appId)

  closeViews(context.slack, stack)
  if (view.view.notify_on_close !== true || !app.app) return

  context.events.interaction(app.app.appId, {
    type: "view_closed",
    ...people(context, user),
    api_app_id: app.app.appId,
    token: app.app.verificationToken,
    view: viewObject(view, teamOf(context.slack).teamId, app.install?.botId ?? ""),
    is_cleared: stack.length > 1,
  })
}
