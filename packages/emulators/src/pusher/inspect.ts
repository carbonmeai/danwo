/** What tests read from and do to a Pusher emulator besides calling its API. */
import type { Emulator } from "../define.ts"
import { waitUntil } from "../poll.ts"
import type { Store } from "../store.ts"
import type { PusherHub } from "./channels.ts"
import type { BeamsDevice, BeamsPublish, PusherEvent } from "./entities.ts"
import { PUSHER_DEFAULTS } from "./seed.ts"
import { pusherStore } from "./store.ts"

/** Each emulator's live connections, by its store. */
const HUBS = new WeakMap<Store, PusherHub>()

/** Remembers the hub of the emulator owning `store`, for `pusherChannels`. */
export function registerHub(store: Store, hub: PusherHub): void {
  HUBS.set(store, hub)
}

/** A Pusher emulator's Channels side as tests read and drive it. */
export interface PusherChannels {
  /** Events published on channels (by the API, clients or the test), oldest first, filtered. */
  events(filter?: {
    channel?: string
    name?: string
    source?: PusherEvent["source"]
  }): PusherEvent[]
  /** Waits up to `timeoutMs` (10 s by default) for an event named `name` on `channel`. */
  waitFor(channel: string, name: string, options?: { timeoutMs?: number }): Promise<PusherEvent>
  /** The open connections: socket id, channels joined, signed-in user. */
  connections(): ReturnType<PusherHub["list"]>
  /**
   * Publishes `name` on `channel` from the test, as the server would; resolves to the socket ids
   * it reached. `appId` defaults to the only (or default) app.
   */
  trigger(channel: string, name: string, data: unknown, appId?: string): string[]
}

/** The live connections of the Pusher emulator owning `store`. */
export function hubFor(store: Store): PusherHub {
  const hub = HUBS.get(store)

  if (hub === undefined) throw new Error("not a Pusher emulator")

  return hub
}

const hubOf = (emulator: Pick<Emulator, "store">) => hubFor(emulator.store)

/** The Channels side of a Pusher emulator: published events, live connections, test triggers. */
export function pusherChannels(emulator: Pick<Emulator, "store">): PusherChannels {
  const objects = pusherStore(emulator.store)
  const events = (filter: Parameters<PusherChannels["events"]>[0] = {}) =>
    objects.events.where(
      (event) =>
        (filter.channel === undefined || event.channel === filter.channel) &&
        (filter.name === undefined || event.name === filter.name) &&
        (filter.source === undefined || event.source === filter.source),
    )

  return {
    events,
    async waitFor(channel, name, options = {}) {
      return waitUntil(
        () => events({ channel, name })[0],
        options.timeoutMs ?? 10_000,
        `no Pusher event ${name} on ${channel}`,
      )
    },
    connections: () => hubOf(emulator).list(),
    trigger(channel, name, data, appId) {
      const apps = objects.apps.all()
      const app =
        appId === undefined
          ? (apps.find((found) => found.id !== PUSHER_DEFAULTS.app.id) ?? apps[0])
          : objects.apps.get(appId)

      if (app === undefined) throw new Error(`no Pusher app ${appId ?? ""}`)

      const hub = hubOf(emulator)
      const encoded = typeof data === "string" ? data : JSON.stringify(data)
      const reached = hub.deliver(app, channel, name, encoded, null)

      hub.record(app, {
        channel,
        name,
        data: encoded,
        socket_id: null,
        source: "test",
        user_id: null,
        delivered_to: reached,
      })

      return reached
    },
  }
}

/** A Pusher emulator's Beams side: what was published and which devices registered. */
export interface PusherBeams {
  publishes(filter?: { interest?: string; user?: string }): BeamsPublish[]
  devices(): BeamsDevice[]
}

export function pusherBeams(emulator: Pick<Emulator, "store">): PusherBeams {
  const objects = pusherStore(emulator.store)

  return {
    publishes: (filter = {}) =>
      objects.publishes.where(
        (publish) =>
          (filter.interest === undefined || (publish.interests ?? []).includes(filter.interest)) &&
          (filter.user === undefined || (publish.users ?? []).includes(filter.user)),
      ),
    devices: () => objects.devices.all(),
  }
}
