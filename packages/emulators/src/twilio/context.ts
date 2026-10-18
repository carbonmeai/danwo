import type { App } from "../http.ts"
import type { Outbox } from "../outbox.ts"
import type { Clock, Store } from "../store.ts"
import type { Timer } from "../time.ts"
import type { TwilioStore } from "./store.ts"

/** What every group of Twilio routes is registered with. */
export interface TwilioRouteContext {
  readonly app: App
  readonly twilio: TwilioStore
  readonly outbox: Outbox
  readonly clock: Clock
  /** Runs a message's later status changes on the emulator's time. */
  readonly timer: Timer
  /** The raw store, for values that are not API objects. */
  readonly store: Store
}
