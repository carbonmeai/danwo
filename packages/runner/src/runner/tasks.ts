/**
 * The work a run hands its workers, and what comes back: plain JSON, since it crosses a process
 * boundary. Two kinds of task exist. A test file runs its selected tests, each with its retries,
 * for `danwo test`. A trial runs one test once, clean or with one planned fault, for `danwo matrix`.
 */
import type { PlannedFault, ServiceDelivery } from "@danwo/core"
import type { Exchange } from "@danwo/proxy"

import type { Usage } from "../record/usage.ts"
import type { ReplayDivergence } from "../session.ts"
import type { ErrorClass } from "../support/codes.ts"
import type { SourceLine, TestError } from "../support/errors.ts"
import type { AttemptStatus, ResultStatus } from "../tests/retry.ts"
import type { RecordSettings } from "./record.ts"

/** What a worker needs before its first task: where the project is and how to record. */
export interface WorkerStart {
  readonly cwd: string
  readonly configPath: string | undefined
  readonly workerIndex: number
  /** The flight recorder's run directory and mode; absent records nothing. */
  readonly record: RecordSettings | undefined
  /** Rewrite every `toHaveScreenshot` baseline instead of comparing with it. */
  readonly updateScreenshots: boolean
}

/** `danwo test`: the selected tests of one file, run in declaration order. */
export interface TestFileTask {
  readonly file: string
  readonly testIds: readonly string[]
  /** Extra attempts for a failing test, unless the test sets its own. */
  readonly retries: number
  /** Absolute replay cache directory; undefined runs without one. */
  readonly cacheDir: string | undefined
}

/** `danwo matrix`: one run of one test. The clean trial records; a faulted one only replays. */
export interface TrialTask {
  readonly file: string
  readonly testId: string
  /** Null for the clean trial. */
  readonly fault: PlannedFault | null
  readonly cacheDir: string
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
}

/** A test's result over its attempts. */
export interface TestReport {
  readonly id: string
  readonly status: ResultStatus
  readonly attempts: readonly AttemptReport[]
  readonly workerIndex: number
}

/** A trial's outcome, with the evidence the matrix plans faults from and checks they fired. */
export interface TrialReport {
  readonly status: "passed" | "failed"
  readonly error: string | null
  /** Calls through the proxy, without bodies: the flight record keeps those. */
  readonly exchanges: readonly Exchange[]
  readonly deliveries: readonly ServiceDelivery[]
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
