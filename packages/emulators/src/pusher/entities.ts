/** What the Pusher emulator stores: apps, the events they carried, and Beams' publishes and devices. */

/** A Channels app: its credentials and the webhooks it sends. */
export interface PusherApp {
  /** The app id (`PUSHER_APP_ID`). */
  id: string
  /** The public key clients connect with (`/app/<key>`). */
  key: string
  /** Signs API requests, channel authorisations and webhooks. */
  secret: string
  cluster: string
  /**
   * Whether the app reports `subscription_count`: an app setting, off unless turned on in the
   * app's settings. Asking for the count while it is off is refused.
   */
  subscription_counting: boolean
  /** Where the app's webhooks go, and which kinds each gets (all, without `events`). */
  webhooks: { url: string; events: PusherWebhookKind[] | null }[]
}

/** The webhook events Pusher sends about channels, members and client events. */
export type PusherWebhookKind =
  | "channel_occupied"
  | "channel_vacated"
  | "member_added"
  | "member_removed"
  | "client_event"

/** One event published on a channel: by the API, by a client, or from a test. */
export interface PusherEvent {
  id: string
  app_id: string
  channel: string
  name: string
  /** The event's data as it travels: a string (the server SDKs JSON-encode objects). */
  data: string
  /** The connection excluded from delivery (`socket_id`), or the client that sent it. */
  socket_id: string | null
  source: "api" | "client" | "test"
  /** For a client event on a presence channel: the member who sent it. */
  user_id: string | null
  /** Connections it reached. */
  delivered_to: string[]
  at: string
}

/** A Beams instance: the push notifications service. */
export interface BeamsInstance {
  id: string
  /** The secret the server SDK authorises with (`Bearer <secretKey>`). */
  secret_key: string
}

/** One publish to devices, by interests or by users. */
export interface BeamsPublish {
  id: string
  instance_id: string
  interests: string[] | null
  users: string[] | null
  /** The publish request as sent: `web`, `fcm` and `apns` payloads. */
  request: Record<string, unknown>
  at: string
}

/** A browser or device registered with Beams. */
export interface BeamsDevice {
  id: string
  instance_id: string
  platform: "web" | "fcm" | "apns"
  /** The push token or web push subscription it registered with. */
  token: unknown
  interests: string[]
  user_id: string | null
  metadata: Record<string, unknown>
}
