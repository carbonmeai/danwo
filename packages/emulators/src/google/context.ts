import type { App } from "../http.ts"
import type { SigningKey } from "../oauth/jwt.ts"
import type { Outbox } from "../outbox.ts"
import type { Clock, Store } from "../store.ts"
import type { GoogleStore } from "./store.ts"

/** What every group of Google routes is registered with. */
export interface GoogleRouteContext {
  readonly app: App
  readonly google: () => GoogleStore
  readonly clock: Clock
  readonly store: Store
  /** Push notifications wait here for the dispatcher. */
  readonly outbox: Outbox
  /** Signs ID tokens; its public half is served at the JWKS and v1 certificate URLs. */
  readonly key: SigningKey
}
