import type { DataProxy } from "@danwo/infra"
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
   * Proxies in front of the app's own database and cache, e.g. `startPostgresProxy(…)`: the app
   * connects through them, and `danwo matrix` faults the statements and commands its tests send
   * (a lost COMMIT reply, a serialization failure, a cache that answers OOM).
   */
  readonly data?: readonly DataProxy[] | undefined
  /**
   * A mobile device the worker's tests run on instead of a browser, e.g. `androidDevice()` from
   * @danwo/mobile: each attempt resets and launches the app on it, and `screen`, `app` and `expect`
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
  /**
   * Lets pending background work finish (e.g. webhook deliveries on a manual clock) before a
   * test's invariant or a matrix run's evidence is read. It may say what it waited for, one line
   * each; the flight record shows that on the settle step.
   */
  settle?(): Promise<void | readonly string[]>
  /**
   * Moves time forward by `ms` for everything behind the app: the apps' clocks (through the
   * proxy) and every emulator's clock, running renewals, retries and expiries as they fall due.
   * The service environments (`stripeEnvironment`, `startServices`…) provide it; without it,
   * `time.travel` moves only the apps' clocks and the browser's.
   */
  travel?(ms: number): Promise<void>
  /**
   * Back to a clean state (emulators to their seeds, app state, fault rules), before the tests
   * and matrix trials that need one; see the config's `isolation`.
   */
  reset?(): Promise<void>
  /**
   * Keeps the state it is in now for `restore()` to return to: e.g. emulator stores in memory, a
   * Postgres template database, a copy of a data folder. Called right after a `reset()`, and again
   * after setup the next tests start from (a file's `beforeAll`, a saved session's sign-in).
   * Optional, and only used together with `restore`. With `snapshotSlots`, `slot` names which of
   * several kept states this one is (`pristine`, `file`, `pristine+<session>`, ...); without it
   * there is one, and `slot` is not passed.
   */
  snapshot?(slot?: string): Promise<void>
  /**
   * Back to what `snapshot()` kept (in `slot`, with `snapshotSlots`), faster than `reset()`. A
   * worker resets its environment once, snapshots it, and restores it before every later test and
   * trial. Like `reset`, it also clears the proxy's log, fault rules and the apps' clock offset.
   * The app's own memory is the environment's to reset here (e.g. by calling a test-reset
   * endpoint). Without it, each test resets.
   */
  restore?(slot?: string): Promise<void>
  /**
   * Whether `snapshot(slot)` and `restore(slot)` keep a separate state per slot. With it, a saved
   * session's sign-in is kept beside the seeded state, so a test that names the session starts
   * signed in and one that does not starts from the seeded state. Without it, there is one kept
   * state: the seeded one, and a session signs in again for every test that names it.
   */
  readonly snapshotSlots?: boolean
  /** Facts to print next to a matrix run's verdict. */
  notes?(): readonly string[]
  /**
   * Apps the environment started that have since stopped on their own, e.g. `api exited with code
   * 1`: a test that fails after one went down says so, rather than leaving only its symptoms (a
   * refused connection, a page that never loads).
   */
  stopped?(): readonly string[]
  /**
   * What each app the environment started has written, by app: the flight record keeps the lines
   * written during each run.
   */
  logs?(): Readonly<Record<string, ProcessLog>>
  /**
   * State the flight recorder keeps when a run ends, by service (what an invariant reads from).
   * Default: a snapshot of every emulator among `fixtures`.
   */
  state?(): Readonly<Record<string, unknown>>
  close(): Promise<void>
}

/** One process's output: its latest lines, and how many it has written in all. */
export interface ProcessLog {
  /** The latest lines, oldest first; earlier ones are dropped past a cap. */
  readonly lines: readonly string[]
  /** Lines written since the process started, kept or not: a run marks where it began by this. */
  readonly written: number
}

/** What a config's `environment()` is called with, once per worker. */
export interface EnvironmentContext {
  /** 0-based worker slot; use it to keep ports and data apart between workers. */
  readonly workerIndex: number
}
