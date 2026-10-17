import type { App } from "../http.ts"
import type { Clock, Store } from "../store.ts"
import type { GithubEvents } from "./events.ts"
import type { GithubStore } from "./store.ts"

/** What every group of GitHub routes is registered with. */
export interface GithubRouteContext {
  readonly app: App
  readonly store: Store
  readonly clock: Clock
  readonly github: () => GithubStore
  /** Queues webhook deliveries for repository hooks and installed apps. */
  readonly events: GithubEvents
}
