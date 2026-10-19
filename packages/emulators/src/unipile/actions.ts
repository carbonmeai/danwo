/**
 * What changes Unipile's state and tells the app: an account connecting or losing its session, a
 * message sent or received in a chat, mail sent or received. Each queues the webhook the matching
 * subscriptions get (`messaging`, `email`, `account_status`).
 */
import { randomBytes } from "node:crypto"

import { emailObject } from "./formatters.ts"
import { notFound, unipileId, type UnipileRouteContext } from "./helpers.ts"
import type {
  UnipileAccountRecord,
  UnipileAccountType,
  UnipileAttendee,
  UnipileChatRecord,
  UnipileEmailRecord,
  UnipileMessageRecord,
  UnipileSourceStatus,
} from "./store.ts"

/** A LinkedIn-style member id, as provider ids look. */
const providerId = () => `ACoAA${randomBytes(12).toString("base64url")}`

/** Adds a connected account, with the attendee that stands for its owner. */
export function addAccount(
  context: UnipileRouteContext,
  input: {
    readonly type: UnipileAccountType
    readonly name: string
    readonly username: string
    readonly id?: string
  },
): UnipileAccountRecord {
  const [first = input.name, ...rest] = input.name.split(" ")
  const account: UnipileAccountRecord = {
    id: input.id ?? unipileId(),
    type: input.type,
    name: input.name,
    created_at: context.clock().toISOString(),
    status: "OK",
    owner: {
      provider_id: providerId(),
      first_name: first,
      last_name: rest.join(" "),
      username: input.username,
    },
  }

  context.objects.accounts.add(account, null)
  context.objects.attendees.add(
    {
      id: unipileId(),
      account_id: account.id,
      provider_id: account.owner.provider_id,
      name: account.name,
      is_self: 1,
      profile_url: `https://www.linkedin.com/in/${input.username}`,
    },
    null,
  )

  return account
}

/** Tells `account_status` subscriptions how an account stands: `OK`, `CREDENTIALS`, `CREATION_SUCCESS`… */
export function accountStatus(
  context: UnipileRouteContext,
  account: UnipileAccountRecord,
  message: string,
): void {
  context.outbox.push("account_status", {
    AccountStatus: { account_id: account.id, account_type: account.type, message },
  })
}

/** Changes how an account's source stands, and says so. */
export function setStatus(
  context: UnipileRouteContext,
  account: UnipileAccountRecord,
  status: UnipileSourceStatus,
): void {
  context.objects.accounts.change(account.id, { status })
  accountStatus(context, account, status)
}

function selfOf(context: UnipileRouteContext, account: UnipileAccountRecord): UnipileAttendee {
  const self = context.objects.attendees.where(
    (a) => a.account_id === account.id && a.is_self === 1,
  )[0]

  if (!self) throw notFound(`account ${account.id}'s profile`)

  return self
}

/** The attendee for `providerId` in `account`'s network, made when first seen. */
export function attendeeFor(
  context: UnipileRouteContext,
  account: UnipileAccountRecord,
  provider: string,
  name?: string,
): UnipileAttendee {
  const known = context.objects.attendees.where(
    (a) => a.account_id === account.id && a.provider_id === provider,
  )[0]

  /* An attendee first seen by id alone takes the name it is later given. */
  if (known && name !== undefined && known.name === known.provider_id)
    return context.objects.attendees.change(known.id, { name }) ?? known
  if (known) return known

  return context.objects.attendees.add(
    {
      id: unipileId(),
      account_id: account.id,
      provider_id: provider,
      name: name ?? provider,
      is_self: 0,
      profile_url: `https://www.linkedin.com/in/${provider}`,
    },
    null,
  )
}

/** A new chat between `account` and `others`. */
export function startChat(
  context: UnipileRouteContext,
  account: UnipileAccountRecord,
  others: readonly UnipileAttendee[],
): UnipileChatRecord {
  return context.objects.chats.add(
    {
      id: unipileId(),
      account_id: account.id,
      provider_id: `2-${randomBytes(12).toString("base64url")}`,
      name: others.length === 1 ? (others[0]?.name ?? null) : null,
      attendee_ids: [selfOf(context, account).id, ...others.map((a) => a.id)],
      unread_count: 0,
      timestamp: null,
    },
    null,
  )
}

/** A message in `chat`, from the account's owner or from another attendee; announced to `messaging` subscriptions. */
export function postMessage(
  context: UnipileRouteContext,
  chat: UnipileChatRecord,
  text: string,
  from?: UnipileAttendee,
): UnipileMessageRecord {
  const account = context.objects.accounts.get(chat.account_id)

  if (!account) throw notFound(`account ${chat.account_id}`)

  const sender = from ?? selfOf(context, account)
  const timestamp = context.clock().toISOString()
  const message = context.objects.messages.add(
    {
      id: unipileId(),
      account_id: account.id,
      chat_id: chat.id,
      provider_id: `2-${randomBytes(16).toString("base64url")}`,
      sender_id: sender.provider_id,
      sender_attendee_id: sender.id,
      text,
      timestamp,
      is_sender: sender.is_self,
      seen: sender.is_self,
    },
    null,
  )

  context.objects.chats.change(chat.id, {
    timestamp,
    unread_count: chat.unread_count + (sender.is_self === 1 ? 0 : 1),
  })
  context.outbox.push("messaging", {
    account_id: account.id,
    account_type: account.type,
    account_info: { type: account.type, feature: "classic", user_id: account.owner.provider_id },
    event: "message_received",
    chat_id: chat.id,
    timestamp,
    webhook_name: "messaging",
    message_id: message.id,
    message: text,
    sender: {
      attendee_id: sender.id,
      attendee_name: sender.name,
      attendee_provider_id: sender.provider_id,
      attendee_profile_url: sender.profile_url,
    },
    attendees: chat.attendee_ids.flatMap((id) => {
      const attendee = context.objects.attendees.get(id)

      return attendee
        ? [
            {
              attendee_id: attendee.id,
              attendee_name: attendee.name,
              attendee_provider_id: attendee.provider_id,
            },
          ]
        : []
    }),
    attachments: [],
    provider_chat_id: chat.provider_id,
    provider_message_id: message.provider_id,
    is_event: 0,
    is_group: chat.attendee_ids.length > 2 ? 1 : 0,
  })

  return message
}

/** Mail from or to `account`, announced to `email` subscriptions as `mail_sent` or `mail_received`. */
export function fileEmail(
  context: UnipileRouteContext,
  account: UnipileAccountRecord,
  input: Omit<
    UnipileEmailRecord,
    "id" | "account_id" | "provider_id" | "message_id" | "date" | "folders" | "tracking_id"
  >,
): UnipileEmailRecord {
  const email = context.objects.emails.add(
    {
      ...input,
      id: unipileId(),
      account_id: account.id,
      provider_id: randomBytes(8).toString("hex"),
      message_id: `<${unipileId()}@danwo.test>`,
      date: context.clock().toISOString(),
      folders: [input.role === "sent" ? "SENT" : "INBOX"],
      tracking_id: unipileId(),
    },
    null,
  )

  context.outbox.push("email", {
    ...emailObject(email, account.type),
    email_id: email.id,
    event: input.role === "sent" ? "mail_sent" : "mail_received",
    webhook_name: "email",
  })

  return email
}
