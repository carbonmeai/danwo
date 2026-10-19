/**
 * The Inbox's realtime socket (`wss://socket.novu.co?token=<session token>`): a subscriber's
 * browsers hear of each new in-app notification and of their unseen and unread counts changing.
 * Connections are not stored state; a reset closes them and clients reconnect.
 */
import type { EmulatorSocket, SocketSession, SocketUpgrade } from "../sockets.ts"
import type { NovuMessage, NovuSubscriber } from "./entities.ts"
import { inboxNotification } from "./formatters.ts"
import type { NovuStore } from "./store.ts"

export class NovuRealtime {
  private readonly sockets = new Map<string, Set<EmulatorSocket>>()
  private readonly objects: NovuStore

  constructor(objects: NovuStore) {
    this.objects = objects
  }

  /** Answers an Inbox socket: its `token` names the session, and so the subscriber. */
  open(socket: EmulatorSocket, upgrade: SocketUpgrade): SocketSession | undefined {
    const token = upgrade.url.searchParams.get("token") ?? ""
    const session = this.objects.sessions.get(token)

    if (session === undefined) {
      socket.close(4401, "Unauthorized")

      return undefined
    }

    const own = this.sockets.get(session.subscriber_id) ?? new Set<EmulatorSocket>()

    own.add(socket)
    this.sockets.set(session.subscriber_id, own)

    return {
      message: () => undefined,
      closed: () => own.delete(socket),
    }
  }

  /** Tells the subscriber's open Inboxes of a new notification and their new counts. */
  notify(message: NovuMessage, subscriber: NovuSubscriber | undefined): void {
    this.send(message.subscriber_id, "notification_received", {
      message: inboxNotification(message, subscriber),
    })
    this.counts(message.subscriber_id)
  }

  /** Sends a subscriber's unseen and unread counts, after they changed. */
  counts(subscriberId: string): void {
    const inbox = this.objects.messages.where(
      (message) =>
        message.channel === "in_app" && message.subscriber_id === subscriberId && !message.archived,
    )
    const unread = inbox.filter((message) => !message.read).length

    this.send(subscriberId, "unseen_count_changed", {
      unseenCount: inbox.filter((message) => !message.seen).length,
    })
    this.send(subscriberId, "unread_count_changed", {
      unreadCount: unread,
      counts: { total: unread, severity: {} },
    })
  }

  /** Inboxes open right now, by subscriber id. */
  inboxes(): Record<string, number> {
    return Object.fromEntries([...this.sockets].map(([id, set]) => [id, set.size]))
  }

  closeAll(): void {
    for (const set of this.sockets.values())
      for (const socket of set) socket.close(4200, "Emulator reset")
    this.sockets.clear()
  }

  private send(subscriberId: string, event: string, data: unknown): void {
    for (const socket of this.sockets.get(subscriberId) ?? [])
      socket.send(JSON.stringify({ event, data }))
  }
}
