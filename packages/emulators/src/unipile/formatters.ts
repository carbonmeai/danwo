/** Unipile objects as the API returns them, in the shapes the SDK's validators accept. */
import type {
  UnipileAccountRecord,
  UnipileAttendee,
  UnipileChatRecord,
  UnipileEmailRecord,
  UnipileMessageRecord,
  UnipileStore,
  UnipileWebhookRecord,
} from "./store.ts"

/** An account's `connection_params`, by the kind of account it is. */
function connectionParams(account: UnipileAccountRecord) {
  switch (account.type) {
    case "LINKEDIN":
      return {
        im: {
          id: account.owner.provider_id,
          username: account.owner.username,
          premiumContractId: null,
        },
      }
    case "WHATSAPP":
      return { im: { phone_number: account.owner.username } }
    case "MAIL":
      return {
        mail: {
          imap_host: "imap.danwo.test",
          imap_port: 993,
          imap_user: account.owner.username,
          smtp_host: "smtp.danwo.test",
          smtp_port: 465,
          smtp_user: account.owner.username,
        },
      }
    default:
      return { mail: { id: account.owner.provider_id, username: account.owner.username } }
  }
}

/** The account's sources: messaging for chat accounts, mail for mail accounts. */
function sourcesOf(account: UnipileAccountRecord) {
  const kind = account.type === "LINKEDIN" || account.type === "WHATSAPP" ? "MESSAGING" : "MAILS"

  return [{ id: `${account.id}_${kind}`, status: account.status }]
}

export function accountObject(account: UnipileAccountRecord) {
  return {
    object: "Account",
    type: account.type,
    id: account.id,
    name: account.name,
    created_at: account.created_at,
    connection_params: connectionParams(account),
    groups: [],
    sources: sourcesOf(account),
  }
}

export function attendeeObject(attendee: UnipileAttendee) {
  return {
    object: "ChatAttendee",
    id: attendee.id,
    account_id: attendee.account_id,
    provider_id: attendee.provider_id,
    name: attendee.name,
    is_self: attendee.is_self,
    hidden: 0,
    profile_url: attendee.profile_url,
  }
}

export function messageObject(message: UnipileMessageRecord, chat: UnipileChatRecord) {
  return {
    object: "Message",
    id: message.id,
    account_id: message.account_id,
    chat_id: message.chat_id,
    chat_provider_id: chat.provider_id,
    provider_id: message.provider_id,
    sender_id: message.sender_id,
    sender_attendee_id: message.sender_attendee_id,
    text: message.text,
    attachments: [],
    timestamp: message.timestamp,
    is_sender: message.is_sender,
    reactions: [],
    seen: message.seen,
    seen_by: {},
    hidden: 0,
    deleted: 0,
    edited: 0,
    is_event: 0,
    delivered: 1,
    behavior: null,
    original: "{}",
  }
}

export function chatObject(objects: UnipileStore, chat: UnipileChatRecord) {
  const account = objects.accounts.get(chat.account_id)
  const last = objects.messages.where((m) => m.chat_id === chat.id).at(-1)
  const other = chat.attendee_ids
    .map((id) => objects.attendees.get(id))
    .find((a) => a?.is_self === 0)

  return {
    object: "Chat",
    id: chat.id,
    account_id: chat.account_id,
    account_type: account?.type === "WHATSAPP" ? "WHATSAPP" : "LINKEDIN",
    provider_id: chat.provider_id,
    ...(other && { attendee_provider_id: other.provider_id }),
    name: chat.name,
    type: 0,
    timestamp: chat.timestamp,
    unread_count: chat.unread_count,
    archived: 0,
    muted_until: -1,
    read_only: 0,
    lastMessage: last ? messageObject(last, chat) : null,
  }
}

const person = (p: { display_name: string; identifier: string }) => ({
  display_name: p.display_name,
  identifier: p.identifier,
  identifier_type: "EMAIL_ADDRESS",
})

export function emailObject(email: UnipileEmailRecord, type: string) {
  return {
    object: "Email",
    kind: "2_full",
    id: email.id,
    account_id: email.account_id,
    type,
    folderIds: email.folders,
    provider_id: email.provider_id,
    message_id: email.message_id,
    date: email.date,
    subject: email.subject,
    body: email.body,
    body_plain: email.body.replace(/<[^>]+>/g, ""),
    from_attendee: person(email.from),
    to_attendees: email.to.map(person),
    cc_attendees: [],
    bcc_attendees: [],
    reply_to_attendees: [],
    has_attachments: false,
    attachments: [],
    folders: email.folders,
    role: email.role,
    read_date: null,
    is_complete: true,
    origin: "unipile",
    tracking_id: email.tracking_id,
    headers: [],
  }
}

export function webhookObject(objects: UnipileStore, webhook: UnipileWebhookRecord) {
  return {
    object: "Webhook",
    id: webhook.id,
    account_ids: webhook.account_ids.flatMap((id) => {
      const account = objects.accounts.get(id)

      return account
        ? [
            {
              id,
              name: account.name,
              type:
                account.type === "WHATSAPP"
                  ? "WHATSAPP"
                  : account.type === "LINKEDIN"
                    ? "LINKEDIN"
                    : "MAIL",
            },
          ]
        : []
    }),
    enabled: webhook.enabled,
    name: webhook.name,
    request_url: webhook.request_url,
    format: "json",
    headers: webhook.headers,
    data: [],
    ...(webhook.events.length > 0 && { events: webhook.events }),
    type: "AUTO",
  }
}
