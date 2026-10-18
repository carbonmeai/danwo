import type { App } from "../http.ts"
import type { Clock } from "../store.ts"
import type { Timer } from "../time.ts"
import type { BachsEvents } from "./events.ts"
import type { BachsStore } from "./store.ts"

/** What Bachs routes and the work behind them share. */
export interface BachsContext {
  readonly app: App
  readonly bachs: BachsStore
  readonly events: BachsEvents
  readonly clock: Clock
  readonly timer: Timer
  /** Makes sure due work (settlements, renewals, expiries) runs by `at`. */
  readonly wakeAt: (at: Date) => void
}
