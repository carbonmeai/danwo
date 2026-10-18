/*
 * The shapes a `*.danwo.ts` file declares tests with: test, describe, hooks, `test.extend`,
 * `test.use`, `test(...).invariant(fn)` and saved sessions.
 */
import type { Agent } from "../agent/index.ts"
import type { Expect } from "../assert/index.ts"
import type { App } from "../browser/index.ts"
import type { Screen } from "../locate/index.ts"
import type { Secret } from "../secrets/index.ts"
import type { SessionTime } from "../time/index.ts"

/** What every test body, hook and invariant receives before environment and extended fixtures. */
export interface TestFixtures {
  readonly agent: Agent
  readonly screen: Screen
  readonly app: App
  /**
   * Time travel: `await time.travel({ days: 30 })` moves the app's clock, every emulator's clock
   * (renewals, retries and expiries run as they fall due) and the page's clock forward together.
   */
  readonly time: SessionTime
  readonly platform: "web"
}

/** What `beforeAll` and `afterAll` receive: no browser session exists outside a test. */
export interface SuiteFixtures {
  readonly platform: "web"
}

export type TestBody<F> = (fixtures: F) => unknown

/**
 * A test body, hook or invariant as the runner keeps it. Each was type-checked against its
 * fixtures where it was declared; the runner calls it with that same fixtures object. Declared as
 * a method so any `TestBody<F>` fits.
 */
export type StoredBody = { run(fixtures: object): unknown }["run"]

/** Whether `value` can be kept as a test body. */
export function isStoredBody(value: unknown): value is StoredBody {
  return typeof value === "function"
}

/** Options of one test: `test(title, options, body)`. */
export interface TestOptions {
  /** Extra attempts after a failure; overrides the config's `retries`. */
  readonly retries?: number
  /** Milliseconds the body (and its invariant) may take; overrides the config's `timeout`. */
  readonly timeout?: number
  /** Skip the test: `true`, or the reason to report. */
  readonly skip?: boolean | string
  /**
   * Start signed in: the saved session of this name (see `session()`), or `false` to start
   * signed out where an enclosing `test.use` names one.
   */
  readonly session?: string | false
}

/** Options `test.use` applies to every test of its describe block, or of its file at the top level. */
export interface UseOptions {
  /** The saved session the block's tests start in. */
  readonly session?: string
}

/** What a session's setup and check get besides a test's fixtures. */
export interface SessionExtras {
  readonly expect: Expect
  /** A handle for a configured secret, to fill by name without its value reaching the model. */
  readonly secret: (name: string) => Secret
}

/** What a session's setup and check receive: a fresh browser session's handles. */
export interface SessionFixtures extends TestFixtures, SessionExtras {}

/** A session's fixtures as the runner hands them over: the handles plus the environment's fixtures. */
export type SessionArgs = SessionFixtures & Readonly<Record<string, unknown>>

/** Signs in (or reaches whatever state the session stands for) in a fresh browser. */
export type SessionSetup<F = SessionFixtures> = (fixtures: F) => unknown

/**
 * A saved session: `setup` runs once per worker, its browser state (cookies, localStorage,
 * IndexedDB) is kept, and every test that uses the session starts from that state. When the
 * environment resets, the state is dropped and `setup` runs again on next use. `check`, if given,
 * runs at the start of each test that reuses the state and throws when the state no longer works
 * (say, a page that should show the signed-in user); the session is then set up afresh.
 */
export type SessionDefinition<F = SessionFixtures> =
  | SessionSetup<F>
  | { readonly setup: SessionSetup<F>; readonly check?: SessionSetup<F> }

/** The value `test(...)` returns, to attach what must hold whichever way the body went. */
export interface TestCase<F = TestFixtures> {
  invariant(fn: TestBody<F>): TestCase<F>
}

/**
 * Sets up a fixture for one test: everything before `use(value)` is setup, everything after it
 * is teardown, run once the test (hooks and invariant included) is done.
 */
export type FixtureSetup<F, V> = (fixtures: F, use: (value: V) => Promise<void>) => Promise<void>

/** `test.extend` definitions: a setup function per fixture, or a plain value. Omitted keys are typing only. */
export type FixtureDefinitions<T, F> = {
  readonly [K in keyof T]?: FixtureSetup<F & T, T[K]> | T[K]
}

export interface Declare<F> {
  (title: string, body: TestBody<F>): TestCase<F>
  (title: string, options: TestOptions, body: TestBody<F>): TestCase<F>
}

export interface SkipCall<F> extends Declare<F> {
  /** Inside a running test: stop here and report the test as skipped. */
  (reason?: string): void
  /** Inside a running test: skip when `condition` holds. */
  (condition: boolean, reason?: string): void
}

export interface DescribeCall {
  (title: string, body: () => void): void
  readonly skip: (title: string, body: () => void) => void
  readonly only: (title: string, body: () => void) => void
}

/** `test`: declares a test (`test(title, body)`), with `only`, `skip`, `describe`, the hooks, `use`, `session` and `extend` on it. */
export interface TestAPI<F = TestFixtures> extends Declare<F> {
  readonly only: Declare<F>
  readonly skip: SkipCall<F>
  readonly describe: DescribeCall
  readonly beforeEach: (fn: TestBody<F>) => void
  readonly afterEach: (fn: TestBody<F>) => void
  readonly beforeAll: (fn: TestBody<SuiteFixtures>) => void
  readonly afterAll: (fn: TestBody<SuiteFixtures>) => void
  /** Applies `options` to every test of the enclosing describe block, or of the file. */
  readonly use: (options: UseOptions) => void
  /**
   * Defines a saved session for this worker; tests start in it with `test.use({ session: name })`
   * or `{ session: name }` in their options. Names are per worker: the config's `sessions` and
   * every file share them.
   */
  readonly session: (name: string, definition: SessionDefinition<F & SessionExtras>) => void
  /** A `test` whose bodies also receive `T`, set up by `definitions` or by the environment. */
  readonly extend: <T extends object>(definitions?: FixtureDefinitions<T, F>) => TestAPI<F & T>
}
