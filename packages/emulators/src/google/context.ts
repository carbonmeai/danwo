import type { App } from "../http.ts"
import type { SigningKey } from "../oauth/jwt.ts"
import type { Clock } from "../store.ts"
import type { GoogleStore } from "./store.ts"

/** What every group of Google routes is registered with. */
export interface GoogleRouteContext {
  readonly app: App
  readonly google: () => GoogleStore
  readonly clock: Clock
  /** Signs ID tokens; its public half is served at the JWKS and v1 certificate URLs. */
  readonly key: SigningKey
}
