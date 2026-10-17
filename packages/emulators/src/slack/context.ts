import type { App } from "../http.ts"
import type { Clock, Store } from "../store.ts"
import type { TokenRecord } from "./entities.ts"
import type { SlackEvents } from "./events.ts"
import type { Args } from "./helpers.ts"
import type { SlackStore } from "./store.ts"

/** The workspace's state and its event queue, as both routes and test helpers act on them. */
export interface SlackState {
  readonly store: Store
  readonly slack: SlackStore
  readonly events: SlackEvents
  readonly clock: Clock
}

/** What every group of Slack routes and methods is registered with. */
export interface SlackRouteContext extends SlackState {
  readonly app: App
}

/** One authenticated Web API call: its arguments and the token it was made with. */
export interface ApiCall {
  readonly args: Args
  readonly token: TokenRecord
  readonly context: SlackRouteContext
}

/** The fields a method answers with, next to `ok: true`. */
export type MethodResult = Readonly<Record<string, unknown>>

/** A Web API method such as `chat.postMessage`. */
export interface Method {
  /** Scopes any one of which allows the call; empty means any valid token will do. */
  readonly scopes: readonly string[]
  readonly run: (call: ApiCall) => MethodResult | Promise<MethodResult>
}

export type Methods = Readonly<Record<string, Method>>
