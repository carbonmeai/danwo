import type { App } from "../http.ts"
import type { Clock } from "../store.ts"
import type { StripeEvents } from "./events.ts"
import type { StripeStore } from "./store.ts"

/** What every group of Stripe routes is registered with. */
export interface StripeRouteContext {
  readonly app: App
  readonly objects: StripeStore
  readonly events: StripeEvents
  /** The emulator's origin, for the URLs of hosted pages. */
  readonly baseUrl: string
  readonly clock: Clock
  /** Makes sure due billing work (renewals, trial ends, expiries) runs by `at` on the clock. */
  readonly wakeAt: (at: Date) => void
}
