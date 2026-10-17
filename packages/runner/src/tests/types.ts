import type { Agent } from "../agent/index.ts"
/*
 * The shapes a `*.danwo.ts` file declares tests with: test, describe, hooks, `test.extend` and
 * `test(...).invariant(fn)`.
 */
import type { App } from "../browser/index.ts"
import type { Screen } from "../locate/index.ts"

/** What every test body, hook and invariant receives before environment and extended fixtures. */
export interface TestFixtures {
  readonly agent: Agent
  readonly screen: Screen
  readonly app: App
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

export interface TestOptions {
  /** Extra attempts after a failure; overrides the config's `retries`. */
  readonly retries?: number
  /** Milliseconds the body (and its invariant) may take; overrides the config's `timeout`. */
  readonly timeout?: number
  /** Skip the test: `true`, or the reason to report. */
  readonly skip?: boolean | string
}

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

export interface TestAPI<F = TestFixtures> extends Declare<F> {
  readonly only: Declare<F>
  readonly skip: SkipCall<F>
  readonly describe: DescribeCall
  readonly beforeEach: (fn: TestBody<F>) => void
  readonly afterEach: (fn: TestBody<F>) => void
  readonly beforeAll: (fn: TestBody<SuiteFixtures>) => void
  readonly afterAll: (fn: TestBody<SuiteFixtures>) => void
  /** A `test` whose bodies also receive `T`, set up by `definitions` or by the environment. */
  readonly extend: <T extends object>(definitions?: FixtureDefinitions<T, F>) => TestAPI<F & T>
}
