/**
 * Pusher's realtime side: the WebSocket protocol clients (`pusher-js`) speak on
 * `ws-<cluster>.pusher.com/app/<key>`, and the live connections events fan out to. Connections are
 * not stored state: a reset closes them (with 4200, which clients answer by reconnecting at once),
 * and what reached them is recorded on each event.
 */
import { asRecord } from "../json.ts"
import type { Outbox } from "../outbox.ts"
import type { EmulatorSocket, SocketSession, SocketUpgrade } from "../sockets.ts"
import type { Clock } from "../store.ts"
import type { PusherApp, PusherEvent } from "./entities.ts"
import { channelAuthValid, userAuthValid } from "./signature.ts"
import type { PusherStore } from "./store.ts"

/** A presence channel member: the `user_id` and `user_info` its `channel_data` gave. */
interface Member {
  readonly user_id: string
  readonly user_info: unknown
}

/** One open connection: the app it belongs to, the channels it joined, who signed in on it. */
interface Connection {
  readonly socketId: string
  readonly app: PusherApp
  readonly socket: EmulatorSocket
  /** Channel name to the member it joined as (presence) or null. */
  readonly channels: Map<string, Member | null>
  userId: string | null
}

/** A protocol message, as both sides send it: `data` is JSON-encoded in a string. */
function frame(event: string, data: unknown, channel?: string): string {
  return JSON.stringify({
    event,
    ...(channel !== undefined && { channel }),
    data: typeof data === "string" ? data : JSON.stringify(data),
  })
}

/** A client message's fields, `data` decoded when it was sent as a string. */
function parse(
  text: string,
): { event: string; channel: string | undefined; data: unknown } | undefined {
  try {
    const message = asRecord(JSON.parse(text))
    const event = message?.["event"]

    if (typeof event !== "string") return undefined

    const raw = message?.["data"]
    let data: unknown = raw

    if (typeof raw === "string")
      try {
        data = JSON.parse(raw)
      } catch {
        data = raw
      }

    const channel = message?.["channel"]

    return { event, channel: typeof channel === "string" ? channel : undefined, data }
  } catch {
    return undefined
  }
}

const isPrivate = (channel: string) => channel.startsWith("private-")
const isPresence = (channel: string) => channel.startsWith("presence-")
/** The channel a signed-in user's server-to-user events travel on. */
const userChannel = (userId: string) => `#server-to-user-${userId}`

/** The connections, and what the realtime side tells webhooks. */
export class PusherHub {
  private readonly connections = new Map<string, Connection>()
  private readonly objects: PusherStore
  private readonly outbox: Outbox
  private readonly clock: Clock

  constructor(objects: PusherStore, outbox: Outbox, clock: Clock) {
    this.objects = objects
    this.outbox = outbox
    this.clock = clock
  }

  /** Answers a new connection to `/app/<key>`. */
  open(socket: EmulatorSocket, upgrade: SocketUpgrade): SocketSession | undefined {
    const key = /^\/app\/([^/?]+)/.exec(upgrade.url.pathname)?.[1]
    const app = key === undefined ? undefined : this.objects.appByKey(decodeURIComponent(key))

    if (app === undefined) {
      socket.send(
        frame("pusher:error", {
          code: 4001,
          message: `App key ${key ?? ""} not in this cluster. Did you forget to specify the cluster?`,
        }),
      )
      socket.close(4001, "App key not in this cluster")

      return undefined
    }

    const socketId = `${this.objects.next()}.${Math.floor(Math.random() * 1e9)}`
    const connection: Connection = { socketId, app, socket, channels: new Map(), userId: null }

    this.connections.set(socketId, connection)
    socket.send(
      frame("pusher:connection_established", { socket_id: socketId, activity_timeout: 120 }),
    )

    return {
      message: (data) => {
        if (typeof data === "string") this.handle(connection, data)
      },
      closed: () => this.drop(connection),
    }
  }

  /**
   * Sends an event to every connection on `channel` of `app` but `except` (a socket id), and
   * returns the socket ids it reached.
   */
  deliver(
    app: PusherApp,
    channel: string,
    name: string,
    data: string,
    except: string | null,
  ): string[] {
    const reached: string[] = []

    for (const connection of this.on(app, channel)) {
      if (connection.socketId === except) continue
      connection.socket.send(frame(name, data, channel))
      reached.push(connection.socketId)
    }

    return reached
  }

  /** Connections of `app` on `channel` (signed-in users for a server-to-user channel). */
  on(app: PusherApp, channel: string): Connection[] {
    const forUser = /^#server-to-user-(.+)$/.exec(channel)?.[1]

    return [...this.connections.values()].filter(
      (connection) =>
        connection.app.id === app.id &&
        (forUser === undefined ? connection.channels.has(channel) : connection.userId === forUser),
    )
  }

  /** The members of a presence channel, one per user however many connections they have. */
  members(app: PusherApp, channel: string): Member[] {
    const byUser = new Map<string, Member>()

    for (const connection of this.on(app, channel)) {
      const member = connection.channels.get(channel)

      if (member) byUser.set(member.user_id, member)
    }

    return [...byUser.values()]
  }

  /** The occupied channels of `app`, with how many connections each has. */
  occupied(app: PusherApp): Map<string, number> {
    const counts = new Map<string, number>()

    for (const connection of this.connections.values())
      if (connection.app.id === app.id)
        for (const channel of connection.channels.keys())
          counts.set(channel, (counts.get(channel) ?? 0) + 1)

    return counts
  }

  /** The open connections, for tests: socket id, app, channels and signed-in user. */
  list(): { socket_id: string; app_id: string; channels: string[]; user_id: string | null }[] {
    return [...this.connections.values()].map((connection) => ({
      socket_id: connection.socketId,
      app_id: connection.app.id,
      channels: [...connection.channels.keys()],
      user_id: connection.userId,
    }))
  }

  /** Closes every connection signed in as `userId` (`terminateUserConnections`). */
  terminate(app: PusherApp, userId: string): void {
    for (const connection of this.connections.values())
      if (connection.app.id === app.id && connection.userId === userId)
        connection.socket.close(4009, "Connection terminated by the server")
  }

  /** Closes every connection; clients reconnect at once (code 4200). */
  closeAll(): void {
    for (const connection of this.connections.values())
      connection.socket.close(4200, "Emulator reset, please reconnect")
    this.connections.clear()
  }

  private handle(connection: Connection, text: string): void {
    const message = parse(text)

    if (message === undefined) return

    const data = asRecord(message.data) ?? {}

    switch (message.event) {
      case "pusher:ping":
        connection.socket.send(frame("pusher:pong", {}))
        break
      case "pusher:subscribe":
        this.subscribe(connection, data)
        break
      case "pusher:unsubscribe":
        if (typeof data["channel"] === "string") this.leave(connection, data["channel"])
        break
      case "pusher:signin":
        this.signin(connection, data)
        break
      default:
        if (message.event.startsWith("client-") && message.channel !== undefined)
          this.clientEvent(connection, message.event, message.channel, message.data)
    }
  }

  private error(connection: Connection, message: string, code: number | null = null): void {
    connection.socket.send(frame("pusher:error", { code, message }))
  }

  private subscribe(connection: Connection, data: Record<string, unknown>): void {
    const channel = data["channel"]

    if (typeof channel !== "string" || channel === "") {
      this.error(connection, "Missing channel in subscribe")

      return
    }

    const channelData = typeof data["channel_data"] === "string" ? data["channel_data"] : undefined
    const needsAuth = isPrivate(channel) || isPresence(channel)

    if (channel.startsWith("private-encrypted-")) {
      this.error(connection, "Encrypted channels are not supported by danwo's Pusher emulator")

      return
    }

    if (
      needsAuth &&
      !channelAuthValid(
        connection.app,
        connection.socketId,
        channel,
        data["auth"],
        isPresence(channel) ? channelData : undefined,
      )
    ) {
      this.error(
        connection,
        `Invalid signature: Expected HMAC SHA256 hex digest of ${connection.socketId}:${channel}, but got ${typeof data["auth"] === "string" ? data["auth"] : "nothing"}`,
      )

      return
    }

    if (isPresence(channel)) this.joinPresence(connection, channel, channelData)
    else this.join(connection, channel, null)
  }

  private join(connection: Connection, channel: string, member: Member | null): void {
    const wasEmpty = this.on(connection.app, channel).length === 0

    connection.channels.set(channel, member)
    if (wasEmpty) this.webhook(connection.app, { name: "channel_occupied", channel })
    if (member === null)
      connection.socket.send(frame("pusher_internal:subscription_succeeded", {}, channel))
  }

  private joinPresence(
    connection: Connection,
    channel: string,
    channelData: string | undefined,
  ): void {
    const fields = asRecord(channelData === undefined ? undefined : safeJson(channelData))
    const userId = fields?.["user_id"]

    if (typeof userId !== "string" && typeof userId !== "number") {
      this.error(connection, "Presence channel_data must include a user_id")

      return
    }

    const member: Member = { user_id: String(userId), user_info: fields?.["user_info"] ?? null }
    const known = this.members(connection.app, channel).some((m) => m.user_id === member.user_id)

    this.join(connection, channel, member)

    const members = this.members(connection.app, channel)

    connection.socket.send(
      frame(
        "pusher_internal:subscription_succeeded",
        {
          presence: {
            count: members.length,
            ids: members.map((m) => m.user_id),
            hash: Object.fromEntries(members.map((m) => [m.user_id, m.user_info])),
          },
        },
        channel,
      ),
    )

    if (!known) {
      for (const other of this.on(connection.app, channel))
        if (other !== connection)
          other.socket.send(frame("pusher_internal:member_added", member, channel))
      this.webhook(connection.app, { name: "member_added", channel, user_id: member.user_id })
    }
  }

  private leave(connection: Connection, channel: string): void {
    const member = connection.channels.get(channel)

    if (member === undefined) return

    connection.channels.delete(channel)

    if (
      member !== null &&
      !this.members(connection.app, channel).some((m) => m.user_id === member.user_id)
    ) {
      for (const other of this.on(connection.app, channel))
        other.socket.send(
          frame("pusher_internal:member_removed", { user_id: member.user_id }, channel),
        )
      this.webhook(connection.app, { name: "member_removed", channel, user_id: member.user_id })
    }

    if (this.on(connection.app, channel).length === 0)
      this.webhook(connection.app, { name: "channel_vacated", channel })
  }

  private drop(connection: Connection): void {
    if (!this.connections.has(connection.socketId)) return

    /* Deleting the entry being visited is safe while iterating a Map. */
    for (const channel of connection.channels.keys()) this.leave(connection, channel)
    this.connections.delete(connection.socketId)
  }

  private signin(connection: Connection, data: Record<string, unknown>): void {
    const userData = typeof data["user_data"] === "string" ? data["user_data"] : ""
    const id = asRecord(safeJson(userData))?.["id"]

    if (
      !userAuthValid(connection.app, connection.socketId, userData, data["auth"]) ||
      typeof id !== "string"
    ) {
      this.error(connection, "Invalid signature for pusher:signin", 4009)
      connection.socket.close(4009, "Invalid signin")

      return
    }

    connection.userId = id
    connection.socket.send(frame("pusher:signin_success", { user_data: userData }))
    connection.socket.send(frame("pusher_internal:subscription_succeeded", {}, userChannel(id)))
  }

  private clientEvent(connection: Connection, name: string, channel: string, data: unknown): void {
    if (!isPrivate(channel) && !isPresence(channel)) {
      this.error(
        connection,
        "Client event rejected - only supported on private and presence channels",
      )

      return
    }

    const member = connection.channels.get(channel)

    if (member === undefined) {
      this.error(connection, `Client event rejected - not subscribed to ${channel}`)

      return
    }

    const encoded = typeof data === "string" ? data : JSON.stringify(data)
    const reached: string[] = []

    for (const other of this.on(connection.app, channel)) {
      if (other === connection) continue
      other.socket.send(
        JSON.stringify({
          event: name,
          channel,
          data: encoded,
          ...(member && { user_id: member.user_id }),
        }),
      )
      reached.push(other.socketId)
    }

    this.record(connection.app, {
      channel,
      name,
      data: encoded,
      socket_id: connection.socketId,
      source: "client",
      user_id: member?.user_id ?? null,
      delivered_to: reached,
    })
    this.webhook(connection.app, {
      name: "client_event",
      channel,
      event: name,
      data: encoded,
      socket_id: connection.socketId,
      ...(member && { user_id: member.user_id }),
    })
  }

  /** Keeps an event that was published, and which connections it reached. */
  record(app: PusherApp, event: Omit<PusherEvent, "id" | "app_id" | "at">): PusherEvent {
    return this.objects.events.add(
      {
        ...event,
        id: `evt_${this.objects.next()}`,
        app_id: app.id,
        at: this.clock().toISOString(),
      },
      null,
    )
  }

  /** Queues one webhook event for `app`'s endpoints that want its kind. */
  private webhook(app: PusherApp, event: Record<string, unknown> & { name: string }): void {
    if (app.webhooks.length === 0) return

    this.outbox.push(event.name, {
      app_id: app.id,
      time_ms: this.clock().getTime(),
      events: [event],
    })
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}
