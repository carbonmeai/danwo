import type { ApiCall, Methods } from "../context.ts"
import type { ChannelRecord, MessageRecord, Reaction } from "../entities.ts"
import { requireArg, SlackApiError, stringArg } from "../helpers.ts"
import { requireChannel, requireMember, requireMessage } from "../lookup.ts"
import type { PostingContext } from "../posting.ts"

/** The message a reaction call names, with its channel. */
function target(call: ApiCall): { channel: ChannelRecord; message: MessageRecord; name: string } {
  const { slack } = call.context
  const name = requireArg(call.args, "name", "invalid_name").replace(/^:|:$/g, "")
  const channel = requireChannel(slack, stringArg(call.args, "channel"))

  requireMember(channel, call.token.userId)

  const timestamp = stringArg(call.args, "timestamp")

  if (timestamp === undefined) throw new SlackApiError("no_item_specified")

  return { channel, message: requireMessage(slack, channel.channelId, timestamp), name }
}

/** The reactions with `user` added to (or removed from) the reaction called `name`. */
function withReaction(
  reactions: readonly Reaction[],
  name: string,
  user: string,
  add: boolean,
): Reaction[] {
  const others = reactions.filter((reaction) => reaction.name !== name)
  const users = reactions.find((reaction) => reaction.name === name)?.users ?? []
  const next = add ? [...users, user] : users.filter((id) => id !== user)

  return next.length === 0 ? others : [...others, { name, users: next }]
}

/** One reaction to change: who, which emoji, on which message. */
export interface ReactionChange {
  readonly channel: ChannelRecord
  readonly message: MessageRecord
  readonly user: string
  readonly name: string
  readonly add: boolean
}

/**
 * Adds or removes a reaction and tells subscribed apps; Slack's `already_reacted` and
 * `no_reaction` when there is nothing to change.
 */
export function applyReaction(context: PostingContext, change: ReactionChange): void {
  const { channel, message, user, name, add } = change
  const reacted = message.reactions.some((r) => r.name === name && r.users.includes(user))

  if (add && reacted) throw new SlackApiError("already_reacted")
  if (!add && !reacted) throw new SlackApiError("no_reaction")

  const reactions = withReaction(message.reactions, name, user, add)
  const updated = context.slack.messages.update(message.id, { reactions }) ?? message

  context.events.reaction(add ? "reaction_added" : "reaction_removed", user, name, updated, channel)
}

function react(call: ApiCall, add: boolean) {
  applyReaction(call.context, { ...target(call), user: call.token.userId, add })

  return {}
}

/** `reactions.add` and `reactions.remove`. */
export const reactionMethods: Methods = {
  "reactions.add": { scopes: ["reactions:write"], run: (call) => react(call, true) },
  "reactions.remove": { scopes: ["reactions:write"], run: (call) => react(call, false) },
}
