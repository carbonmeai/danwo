/** Novu's objects as its APIs answer with them: the server API, the v2 subscriber API and the Inbox. */
import type { Context } from "../http.ts"
import type { NovuEnvironment, NovuMessage, NovuSubscriber, NovuTopic } from "./entities.ts"

/** A subscriber, as `subscribers.create`, `retrieve` and `patch` return one. */
export function subscriberObject(env: NovuEnvironment, subscriber: NovuSubscriber) {
  return {
    _id: subscriber.id,
    subscriberId: subscriber.subscriber_id,
    firstName: subscriber.first_name,
    lastName: subscriber.last_name,
    email: subscriber.email,
    phone: subscriber.phone,
    avatar: subscriber.avatar,
    locale: subscriber.locale,
    timezone: subscriber.timezone,
    data: subscriber.data,
    channels: subscriber.channels.map((channel) => ({
      providerId: channel.providerId,
      ...(channel.integrationIdentifier && {
        integrationIdentifier: channel.integrationIdentifier,
      }),
      credentials: channel.credentials,
      _integrationId: `${channel.providerId}-integration`,
    })),
    isOnline: false,
    lastOnlineAt: null,
    _organizationId: env.organization_id,
    _environmentId: env.id,
    deleted: false,
    createdAt: subscriber.created,
    updatedAt: subscriber.updated,
    __v: 0,
  }
}

/** The short subscriber some answers embed (topic subscriptions, Inbox `to`). */
export function subscriberSummary(subscriber: NovuSubscriber) {
  return {
    _id: subscriber.id,
    subscriberId: subscriber.subscriber_id,
    firstName: subscriber.first_name,
    lastName: subscriber.last_name,
    email: subscriber.email,
    avatar: subscriber.avatar,
  }
}

export function topicObject(topic: NovuTopic) {
  return {
    _id: topic.id,
    key: topic.key,
    ...(topic.name !== null && { name: topic.name }),
    createdAt: topic.created,
    updatedAt: topic.updated,
  }
}

/** The Inbox's call-to-action block, which its client reads even when empty. */
function ctaOf(message: NovuMessage) {
  return {
    type: "redirect",
    data: message.redirect_url ? { url: message.redirect_url } : {},
    action: { buttons: [], result: { payload: {}, type: null } },
  }
}

/** An in-app message as the realtime socket sends it (the client maps `_id`, `content`, `read`). */
export function inboxNotification(message: NovuMessage, subscriber: NovuSubscriber | undefined) {
  return {
    _id: message.id,
    transactionId: message.transaction_id,
    subject: message.subject ?? undefined,
    content: message.content,
    read: message.read,
    seen: message.seen,
    archived: message.archived,
    snoozedUntil: null,
    deliveredAt: [message.created],
    createdAt: message.created,
    lastReadDate: message.read_at,
    firstSeenDate: message.seen_at,
    archivedAt: message.archived_at,
    channel: "in_app",
    subscriber: subscriber
      ? {
          ...subscriberSummary(subscriber),
          phone: subscriber.phone,
          locale: subscriber.locale,
          data: subscriber.data,
          timezone: subscriber.timezone,
        }
      : { _id: message.subscriber_id, subscriberId: message.subscriber_id },
    cta: ctaOf(message),
    tags: message.tags,
    data: message.data ?? {},
    workflow: {
      id: message.workflow_id,
      identifier: message.workflow_id,
      name: message.workflow_id,
      critical: false,
      tags: message.tags,
      severity: "none",
    },
    severity: "none",
  }
}

/** An in-app message as the v2 subscriber API and the Inbox API list it (the Inbox client's shape). */
export function subscriberNotification(
  message: NovuMessage,
  subscriber: NovuSubscriber | undefined,
) {
  return {
    id: message.id,
    transactionId: message.transaction_id,
    ...(message.subject !== null && { subject: message.subject }),
    body: message.content,
    to: {
      id: subscriber?.id ?? message.subscriber_id,
      subscriberId: message.subscriber_id,
      ...(subscriber?.first_name && { firstName: subscriber.first_name }),
      ...(subscriber?.last_name && { lastName: subscriber.last_name }),
      ...(subscriber?.avatar && { avatar: subscriber.avatar }),
      ...(subscriber?.email && { email: subscriber.email }),
    },
    isRead: message.read,
    isSeen: message.seen,
    isArchived: message.archived,
    isSnoozed: false,
    deliveredAt: [message.created],
    createdAt: message.created,
    readAt: message.read_at,
    firstSeenAt: message.seen_at,
    archivedAt: message.archived_at,
    channelType: "in_app",
    tags: message.tags,
    data: message.data ?? {},
    ...(message.redirect_url && { redirect: { url: message.redirect_url } }),
    workflow: {
      id: message.workflow_id,
      identifier: message.workflow_id,
      name: message.workflow_id,
      critical: false,
      tags: message.tags,
      severity: "none",
    },
    severity: "none",
  }
}

/** Novu's error body: the status, what was wrong, when and where, and the same again in `ctx`. */
export function novuError(c: Context, status: number, message: string): Response {
  const error =
    status === 404
      ? "Not Found"
      : status === 401
        ? "Unauthorized"
        : status === 422
          ? "Unprocessable Entity"
          : "Bad Request"

  return c.json(
    {
      statusCode: status,
      timestamp: new Date().toISOString(),
      path: c.req.path,
      message,
      error,
      ctx: { statusCode: status, error },
    },
    status,
  )
}
