import type { App } from "../http.ts"
import type { Outbox } from "../outbox.ts"
import type { Clock, Store } from "../store.ts"
import type { Timer } from "../time.ts"
import type { FlutterwaveStore } from "./store.ts"

/** What every group of Flutterwave routes is registered with. */
export interface FlutterwaveRouteContext {
  readonly app: App
  readonly flutterwave: FlutterwaveStore
  readonly outbox: Outbox
  readonly clock: Clock
  /** Runs a transfer's later status change on the emulator's time. */
  readonly timer: Timer
  /** The raw store, for ids and values that are not API objects. */
  readonly store: Store
}

/**
 * What payments, transfers and webhooks need: the objects, the outbox and the clock. Outside a
 * request (a test helper) there is no timer, so transfers do not settle there.
 */
export type FlutterwaveState = Pick<
  FlutterwaveRouteContext,
  "flutterwave" | "outbox" | "clock" | "store"
> & {
  readonly timer?: Timer
}
