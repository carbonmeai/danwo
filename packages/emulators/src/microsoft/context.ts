import type { App } from "../http.ts"
import type { SigningKey } from "../oauth/jwt.ts"
import type { Clock } from "../store.ts"
import type { MicrosoftStore } from "./store.ts"

/** What every group of Microsoft routes is registered with. */
export interface MicrosoftRouteContext {
  readonly app: App
  readonly microsoft: () => MicrosoftStore
  readonly clock: Clock
  /** Signs ID tokens; its public half is served at each tenant's keys URL. */
  readonly key: SigningKey
}
