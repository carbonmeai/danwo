import type { Store } from "../store.ts"
import type { PusherWebhookKind } from "./entities.ts"
import { pusherStore } from "./store.ts"

/** A Channels app to answer for: the id, key and secret the app's env holds. */
export type PusherSeedApp = {
  readonly id: string
  readonly key: string
  readonly secret: string
} & Partial<{
  readonly cluster: string
  /**
   * Turns on subscription counting, so channel info can carry `subscription_count`; off by
   * default, as on a new app.
   */
  readonly subscriptionCounting: boolean
  /** Where the app's webhooks go; each endpoint gets every kind unless it lists `events`. */
  readonly webhooks: readonly {
    readonly url: string
    readonly events?: readonly PusherWebhookKind[]
  }[]
}>

/** A Beams instance to answer for (`PUSHER_BEAM_INSTANCE_ID` and its secret key). */
export interface PusherSeedBeams {
  readonly instanceId: string
  readonly secretKey: string
}

/** Data to load into a Pusher emulator. */
export type PusherSeedConfig = Partial<{
  readonly apps: readonly PusherSeedApp[]
  readonly beams: readonly PusherSeedBeams[]
}>

/** The app and Beams instance every Pusher emulator answers for, so a bare start works. */
export const PUSHER_DEFAULTS = {
  app: { id: "1000001", key: "danwo-pusher-key", secret: "danwo-pusher-secret", cluster: "mt1" },
  beams: { instanceId: "danwo-beams-instance", secretKey: "danwo-beams-secret" },
} as const

/** Loads `config` into a Pusher emulator's store; an app or instance seeded again is replaced. */
export function seedPusher(store: Store, config: PusherSeedConfig): void {
  const objects = pusherStore(store)

  for (const app of config.apps ?? []) {
    objects.apps.remove(app.id)
    objects.apps.add(
      {
        id: app.id,
        key: app.key,
        secret: app.secret,
        cluster: app.cluster ?? "mt1",
        subscription_counting: app.subscriptionCounting ?? false,
        webhooks: (app.webhooks ?? []).map((hook) => ({
          url: hook.url,
          events: hook.events ? [...hook.events] : null,
        })),
      },
      null,
    )
  }

  for (const beams of config.beams ?? []) {
    objects.instances.remove(beams.instanceId)
    objects.instances.add({ id: beams.instanceId, secret_key: beams.secretKey }, null)
  }
}
