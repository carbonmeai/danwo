import type { RunWebhooks } from "@danwo/matrix"
import type { Proxy } from "@danwo/proxy"

import type { DeviceTarget } from "../device/types.ts"
import type { MailSource } from "../mail/index.ts"

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
  /**
   * A mobile device the worker's tests run on instead of a browser, e.g. `androidDevice()` from
   * @danwo/device: each attempt resets and launches the app on it, and `screen`, `app` and `expect`
   * act on the device.
   */
  readonly device?: DeviceTarget
  /** Extra fixtures every test in this worker receives, e.g. `stripe`, `inbox`, `settle`. */
  readonly fixtures?: Readonly<Record<string, unknown>>
  /**
   * Where mail the app sends lands, e.g. `[resendMail(resend)]`: tests read it through the `mail`
   * fixture, and the agent reads codes and links from it that replays read again.
   */
  readonly mail?: readonly MailSource[]
  /** Lets pending background work finish (e.g. webhook deliveries on a manual clock) before a matrix run's evidence is read. */
  settle?(): Promise<void>
  /**
   * Moves time forward by `ms` for everything behind the app: the apps' clocks (through the
   * proxy) and every emulator's clock, running renewals, retries and expiries as they fall due.
   * The service environments (`stripeEnvironment`, `startServices`…) provide it; without it,
   * `time.travel` moves only the apps' clocks and the browser's.
   */
  travel?(ms: number): Promise<void>
  /** Back to a clean state between `danwo matrix` runs (emulators, app state, fault rules). */
  reset?(): Promise<void>
  /**
   * Keeps the state it is in now, right after a `reset()`, for `restore()` to return to: e.g.
   * emulator stores in memory, a Postgres template database, a copy of a data folder. Optional,
   * and only used together with `restore`.
   */
  snapshot?(): Promise<void>
  /**
   * Back to what `snapshot()` kept, faster than `reset()`. `danwo matrix` resets each worker's
   * environment once, snapshots it, and restores it before every later trial. Like `reset`, it
   * also clears the proxy's log and fault rules. Without it every trial resets.
   */
  restore?(): Promise<void>
  /** Facts to print next to a matrix run's verdict. */
  notes?(): readonly string[]
  /**
   * State the flight recorder keeps when a run ends, by service (what an invariant reads from).
   * Default: a snapshot of every emulator among `fixtures`.
   */
  state?(): Readonly<Record<string, unknown>>
  close(): Promise<void>
}

/** What a config's `environment()` is called with, once per worker. */
export interface EnvironmentContext {
  /** 0-based worker slot; use it to keep ports and data apart between workers. */
  readonly workerIndex: number
}
