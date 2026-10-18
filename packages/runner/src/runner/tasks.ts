/**
 * The work a run hands its workers, and what comes back: plain JSON, since it crosses a process
 * boundary. Two kinds of task exist. A test file runs its selected tests, each with its retries,
 * for `danwo test`. A trial runs one test once, clean or with one planned fault, for `danwo matrix`.
 */
import type { DataCall } from "@danwo/infra"
import type { PlannedFault, RaceEvidence, ServiceDelivery } from "@danwo/matrix"
import type { Exchange } from "@danwo/proxy"

import type { CheckPace } from "../assert/pace.ts"
import type { LintFinding } from "../lint/index.ts"
import type { Usage } from "../record/usage.ts"
import type { ReplayDivergence } from "../session.ts"
import type { ErrorClass } from "../support/codes.ts"
import type { SourceLine, TestError } from "../support/errors.ts"
import type { AttemptStatus, ResultStatus } from "../tests/retry.ts"
import type { RecordSettings } from "./record.ts"
import type { TrialTimings } from "./timings.ts"

/** What a worker needs before its first task: where the project is and how to record. */
export interface WorkerStart {
  readonly cwd: string
  readonly configPath: string | undefined
  readonly workerIndex: number
  /** The flight recorder's run directory and mode; absent records nothing. */
  readonly record: RecordSettings | undefined
  /** Rewrite every `toHaveScreenshot` baseline instead of comparing with it. */
  readonly updateScreenshots: boolean
  /** `--lint` / `--no-lint`; absent follows the config (on unless it says `lint: false`). */
  readonly lint?: boolean
}

/** `danwo test`: the selected tests of one file, run in declaration order. */
export interface TestFileTask {
  readonly file: string
  readonly testIds: readonly string[]
  /** Extra attempts for a failing test, unless the test sets its own. */
  readonly retries: number
  /** Absolute replay cache directory; undefined runs without one. */
  readonly cacheDir: string | undefined
  /** Replay from the cache without writing new recordings to it (CI runs). */
  readonly cacheReadOnly?: boolean
}

/** `danwo matrix`: one run of one test. The clean trial records; a faulted one only replays. */
export interface TrialTask {
  readonly file: string
  readonly testId: string
  /** Null for the clean trial. */
  readonly fault: PlannedFault | null
  readonly cacheDir: string
  /** For a faulted trial: how long the clean trial's checks took, so its own wait only so long. */
  readonly pace?: CheckPace
}

/** One attempt of a test, as the parent reports it. */
export interface AttemptReport {
  readonly status: AttemptStatus
  readonly error: TestError | undefined
  readonly durationMs: number
  /** The attempt's flight record directory, relative to the cwd, when it was kept. */
  readonly record?: string | undefined
  /** How its agent steps used the replay cache and the model. */
  readonly usage?: Usage
  /** What the integration lint found in the attempt. */
  readonly lint?: readonly LintFinding[]
}

/**
 * What a passing test touched, for picking the tests a change can affect: the app's pages it
 * visited, and the provider calls it caused as route templates (ids folded to `:id`).
 */
export interface TestImpact {
  /** App paths, without query strings, e.g. `/checkout`. */
  readonly routes: readonly string[]
  /** Provider calls, e.g. `POST api.stripe.com/v1/checkout/sessions`. */
  readonly calls: readonly string[]
}

/** A test's result over its attempts. */
export interface TestReport {
  readonly id: string
  readonly status: ResultStatus
  readonly attempts: readonly AttemptReport[]
  readonly workerIndex: number
  /** What its passing attempt touched; absent when no attempt passed. */
  readonly impact?: TestImpact
}

/** A trial's outcome, with the evidence the matrix plans faults from and checks they fired. */
export interface TrialReport {
  readonly status: "passed" | "failed"
  readonly error: string | null
  /** Calls through the proxy, without bodies: the flight record keeps those. */
  readonly exchanges: readonly Exchange[]
  readonly deliveries: readonly ServiceDelivery[]
  /** Calls to the app's own database and cache, when the environment has data proxies. */
  readonly dataCalls?: readonly DataCall[]
  readonly divergence: ReplayDivergence | undefined
  readonly notes: readonly string[]
  /** The trial's flight record directory, relative to the cwd, when it was kept. */
  readonly record?: string | undefined
  /** The test file line the trial's failure passed through, relative to the project root. */
  readonly source?: SourceLine | undefined
  /** The class of the trial's failure; a trial that could not be judged says nothing of its fault. */
  readonly errorClass?: ErrorClass | undefined
  /** How its agent steps used the replay cache and the model. */
  readonly usage?: Usage
  /** Milliseconds in each phase of the trial. */
  readonly timings?: TrialTimings
  /** For a passing clean trial: how long each of its checks took, by `checkKey`. */
  readonly pace?: Readonly<Record<string, number>>
  /** What the integration lint found in the trial. */
  readonly lint?: readonly LintFinding[]
  /** For a passing clean trial: the app requests and returns to the app races can be planned on. */
  readonly races?: RaceEvidence
  /** For a race trial (page, users, redirect): whether its race was set up. */
  readonly fired?: boolean
}

/** What a worker answers, by the name the parent calls it with. */
export interface WorkerCalls {
  start(start: WorkerStart): Promise<void>
  testFile(task: TestFileTask): Promise<readonly TestReport[]>
  trial(task: TrialTask): Promise<TrialReport>
  stop(): Promise<void>
}

/**
 * Progress a worker reports while a task runs. `tested`: a test finished (all its attempts), so it
 * is printed as it happens rather than when its whole file ends.
 */
export type WorkerNote = { readonly topic: "tested"; readonly data: TestReport }
