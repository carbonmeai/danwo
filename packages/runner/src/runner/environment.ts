import type { RunWebhooks } from "@danwo/core"
import type { Proxy } from "@danwo/proxy"

/**
 * What a worker runs its tests against, set up once per worker by the config's `environment`
 * hook: the app's URL, the proxy its browser and app go through, emulators, and any values tests
 * receive as fixtures. Worker-scoped: it lives as long as the worker and is reset between matrix
 * runs.
 */
export interface WorkerEnvironment {
  /** The app's base URL; overrides the config's `baseUrl`. */
  readonly baseUrl?: string | undefined
  /** Routes the browser (and the app, through its own env) to emulators. Required for `danwo matrix`. */
  readonly proxy?: Proxy
  /**
   * Webhook delivery to fault in `danwo matrix`: one dispatcher, or several keyed by service
   * (`{ stripe, resend }`). Without it the matrix plans outbound faults only.
   */
  readonly webhooks?: RunWebhooks | undefined
  /** Extra fixtures every test in this worker receives, e.g. `stripe`, `inbox`, `settle`. */
  readonly fixtures?: Readonly<Record<string, unknown>>
  /** Lets pending background work finish (e.g. webhook deliveries on a manual clock) before a matrix run's evidence is read. */
  settle?(): Promise<void>
  /** Back to a clean state between `danwo matrix` runs (emulators, app state, fault rules). */
  reset?(): Promise<void>
  /** Facts to print next to a matrix run's verdict. */
  notes?(): readonly string[]
  /**
   * State the flight recorder keeps when a run ends, by service (what an invariant reads from).
   * Default: a snapshot of every emulator among `fixtures`.
   */
  state?(): Readonly<Record<string, unknown>>
  close(): Promise<void>
}

export interface EnvironmentContext {
  /** 0-based worker slot; use it to keep ports and data apart between workers. */
  readonly workerIndex: number
}
