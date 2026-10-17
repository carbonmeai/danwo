import type { App } from "../http.ts"
import type { Clock, Store } from "../store.ts"
import type { ResendEvents } from "./events.ts"
import type { ResendStore } from "./store.ts"

/** What every group of Resend routes is registered with. */
export interface ResendRouteContext {
  readonly app: App
  readonly objects: ResendStore
  readonly events: ResendEvents
  readonly clock: Clock
  /** The raw store, for values that are not API objects (idempotency keys, the allowlist). */
  readonly store: Store
}
