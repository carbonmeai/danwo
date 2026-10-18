import type { App } from "../http.ts"
import type { Outbox } from "../outbox.ts"
import type { Clock, Store } from "../store.ts"
import type { Timer } from "../time.ts"
import type { PaystackStore } from "./store.ts"

/** What every group of Paystack routes is registered with. */
export interface PaystackRouteContext {
  readonly app: App
  readonly paystack: PaystackStore
  readonly outbox: Outbox
  readonly clock: Clock
  /** Runs later steps (transfers settling, refunds, subscription renewals) on the emulator's time. */
  readonly timer: Timer
  /** The raw store, for counters that are not API objects. */
  readonly store: Store
}
