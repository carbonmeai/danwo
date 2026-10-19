import { defineEmulator } from "../define.ts"
import { HttpError } from "../errors.ts"
import { asRecord } from "../json.ts"
import type { Store } from "../store.ts"
import type { WebhookEndpoint } from "../webhooks.ts"
import { beamsError, beamsRoutes } from "./beams.ts"
import { PusherHub } from "./channels.ts"
import { hubFor, registerHub } from "./inspect.ts"
import { channelRoutes } from "./routes.ts"
import { PUSHER_DEFAULTS, seedPusher } from "./seed.ts"
import { PUSHER_DELIVERY, pusherWebhookHeaders } from "./signature.ts"
import { pusherStore } from "./store.ts"

export type { BeamsDevice, BeamsPublish, PusherEvent, PusherWebhookKind } from "./entities.ts"
export { pusherOutboundFaults } from "./faults.ts"
export { type PusherBeams, type PusherChannels, pusherBeams, pusherChannels } from "./inspect.ts"
export {
  PUSHER_DEFAULTS,
  type PusherSeedApp,
  type PusherSeedBeams,
  type PusherSeedConfig,
  seedPusher,
} from "./seed.ts"
export { signedQuery as pusherSignedQuery } from "./signature.ts"

/**
 * The hosts the Pusher emulator answers: the Channels API (`api-<cluster>.pusher.com`,
 * `api.pusherapp.com`), the sockets clients connect to (`ws-<cluster>.pusher.com`), and Beams
 * (`<instance>.pushnotifications.pusher.com`).
 */
export const PUSHER_HOSTS: readonly string[] = [
  "*.pusher.com",
  "api.pusherapp.com",
  "ws.pusherapp.com",
]

/** The app id rides along to pick the endpoint's app; Pusher posts only `time_ms` and `events`. */
function posted(body: string): string {
  const { app_id: _app, ...rest } = asRecord(JSON.parse(body)) ?? {}

  return JSON.stringify(rest)
}

/** Every app's webhook endpoints, each signed with its app's key and secret. */
function endpointsOf(store: Store): WebhookEndpoint[] {
  return pusherStore(store)
    .apps.all()
    .flatMap((app) =>
      app.webhooks.map((hook, index) => ({
        id: `${app.id}:${index}`,
        url: hook.url,
        events: hook.events ?? ["*"],
        secret: app.secret,
        enabled: true,
      })),
    )
}

/**
 * Pusher: Channels (the HTTP API that triggers events, the WebSocket protocol `pusher-js` speaks,
 * private and presence channel authorisation, user sign-in, client events, signed webhooks) and
 * Beams (publishes and the device API). An event reaches the connections subscribed to its
 * channel; read what was published and who it reached with `pusherChannels(pusher)`.
 */
export const pusher = defineEmulator({
  name: "pusher",
  setup({ app, store, outbox, clock, wallClock }) {
    const objects = pusherStore(store)
    const hub = new PusherHub(objects, outbox, clock)

    registerHub(store, hub)
    store.whenReset(() => hub.closeAll())

    app.onError((error, c) => {
      const status = error instanceof HttpError ? error.status : 500
      const message = error instanceof Error ? error.message : "Internal Server Error"

      /* Beams answers in JSON; the Channels API in plain text, as the SDKs expect. */
      if (
        c.req.path.startsWith("/publish_api/") ||
        c.req.path.startsWith("/device_api/") ||
        c.req.path.startsWith("/user_api/")
      )
        return beamsError(
          c,
          status,
          status === 401 ? "Unauthorized" : status === 404 ? "Not Found" : "Bad Request",
          message,
        )

      return c.text(message, status)
    })

    channelRoutes({ app, objects, hub, wallClock })
    beamsRoutes({ app, objects, clock })
  },
  seed({ store }) {
    seedPusher(store, {
      apps: [PUSHER_DEFAULTS.app],
      beams: [PUSHER_DEFAULTS.beams],
    })
  },
  webhooks: ({ store }) => ({
    endpoints: () => endpointsOf(store),
    /* Signed over what is posted, with the endpoint's secret, so a forged copy gets a wrong one. */
    sign: ({ endpoint, body }) => {
      const app = pusherStore(store).apps.get(endpoint.id.split(":")[0] ?? "")

      return pusherWebhookHeaders(app?.key ?? "", endpoint.secret, posted(body))
    },
    payload: (_endpoint, body) => posted(body),
    policy: PUSHER_DELIVERY,
  }),
  sockets: ({ store }) => {
    const hub = hubFor(store)

    return (socket, upgrade) => hub.open(socket, upgrade)
  },
})
