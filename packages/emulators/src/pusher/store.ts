import { objectTable } from "../objects.ts"
import type { DataKey, Store } from "../store.ts"
import type {
  BeamsDevice,
  BeamsInstance,
  BeamsPublish,
  PusherApp,
  PusherEvent,
} from "./entities.ts"

const COUNTER: DataKey<number> = { name: "pusher.counter" }

/** The Pusher objects held in an emulator's store. */
export function pusherStore(store: Store) {
  const apps = objectTable<PusherApp>(store, "pusher.apps")

  return {
    apps,
    events: objectTable<PusherEvent>(store, "pusher.events"),
    instances: objectTable<BeamsInstance>(store, "pusher.beams_instances"),
    publishes: objectTable<BeamsPublish>(store, "pusher.beams_publishes"),
    devices: objectTable<BeamsDevice>(store, "pusher.beams_devices"),
    /** The app a key belongs to. */
    appByKey: (key: string) => apps.all().find((app) => app.key === key),
    /** A number that goes up by one on every call, for ids. */
    next(): number {
      const n = (store.getData(COUNTER) ?? 0) + 1

      store.setData(COUNTER, n)

      return n
    },
  }
}

export type PusherStore = ReturnType<typeof pusherStore>
