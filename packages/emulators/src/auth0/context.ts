import type { App } from "../http.ts"
import type { SigningKey } from "../oauth/jwt.ts"
import type { Clock } from "../store.ts"
import type { Auth0Store } from "./store.ts"

/** How the tenant reaches an upstream social provider's token and userinfo endpoints. */
export type Upstream = (request: Request) => Promise<Response>

/** What every group of Auth0 routes is registered with. */
export interface Auth0RouteContext {
  readonly app: App
  readonly clock: Clock
  readonly auth0: () => Auth0Store
  /** Signs ID tokens and API access tokens; every tenant serves its public half. */
  readonly key: SigningKey
  /** Where social logins exchange their code; unset until the runner connects one. */
  readonly upstream: () => Upstream | undefined
}
