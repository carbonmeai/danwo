import type { App } from "../http.ts"
import type { SigningKey } from "../oauth/jwt.ts"
import type { Outbox } from "../outbox.ts"
import type { Clock } from "../store.ts"
import type { MicrosoftStore } from "./store.ts"

/** What Graph's mailbox, calendar and drive logic works with, inside or outside a request. */
export interface GraphState {
  readonly microsoft: () => MicrosoftStore
  readonly clock: Clock
  /** Change notifications for subscriptions are queued here. */
  readonly outbox: Outbox
}

/** What every group of Microsoft routes is registered with. */
export interface MicrosoftRouteContext extends GraphState {
  readonly app: App
  /** Signs ID tokens; its public half is served at each tenant's keys URL. */
  readonly key: SigningKey
}
