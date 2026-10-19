import type { App } from "../http.ts"
import type { Clock, Store } from "../store.ts"
import type { ComposioEvents } from "./events.ts"
import type { ComposioStore } from "./store.ts"

/** What every group of Composio routes is registered with. */
export interface ComposioRouteContext {
  readonly app: App
  readonly objects: ComposioStore
  readonly events: ComposioEvents
  readonly clock: Clock
  /** The raw store: what backends this emulator is connected to is kept against it. */
  readonly store: Store
}
