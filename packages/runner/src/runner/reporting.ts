/**
 * Reporters: what a run tells outside services besides its console lines. A reporter hears when a
 * run starts and gets the whole result when it ends. Reporting never decides a run: a reporter
 * that throws is printed as a warning and the run's exit code stands.
 */
import type { FaultMatrixResult } from "@danwo/matrix"

import type { LintFinding } from "../lint/index.ts"
import type { Usage } from "../record/usage.ts"
import type { VideoMode } from "../record/video.ts"
import type { RecordMode } from "./record.ts"
import type { TestReport } from "./tasks.ts"

/** Which command a run is. */
export type RunKind = "test" | "matrix"

/** What every report shares: the command and where the project and the run's records are. */
export interface RunContext {
  readonly kind: RunKind
  /** The project root: the config file's folder; test files and sources are relative to it. */
  readonly root: string
  /** The folder the command ran in; record folders are relative to it. */
  readonly cwd: string
  /** The run's id, shared by its history summary, its record folder and its live feed. */
  readonly id?: string
  /** How many of the newest runs keep their recordings, when the run recorded. */
  readonly keepRuns?: number
}

/** `danwo test` once every test reported. */
export interface TestRunReport extends RunContext {
  readonly kind: "test"
  readonly reports: readonly TestReport[]
  /** Test files that could not run at all (they failed to load, or their worker died). */
  readonly brokenFiles: readonly { readonly file: string; readonly error: string }[]
  readonly durationMs: number
  /** The run's HTML report, relative to `cwd`, when one was written. */
  readonly reportPath: string | undefined
  /** The run's flight-record folder name under `.danwo/runs`, when it recorded. */
  readonly run?: string
  /** Which shard of a split run this was, as `i/n`; `danwo merge-reports` reports the whole. */
  readonly shard?: string
}

/** `danwo matrix` once every trial finished. */
export interface MatrixRunReport extends RunContext {
  readonly kind: "matrix"
  /** The test's id (its file and title path). */
  readonly testId: string
  /** The test file, relative to `root`. */
  readonly file: string
  readonly result: FaultMatrixResult
  readonly durationMs: number
  readonly reportPath: string | undefined
  /** How the trials' agent steps used the replay cache and the model, added up. */
  readonly usage?: Usage
  /**
   * What judged the faulted trials: the test's invariant, or its body passing under every fault.
   */
  readonly judgedBy?: "invariant" | "body"
  /** What the integration lint found, by the trial it was found in. */
  readonly lint?: readonly TrialFindings[]
}

/** A matrix trial's lint findings, with the trial's label (`clean` for the clean run). */
export interface TrialFindings {
  readonly trial: string
  readonly findings: readonly LintFinding[]
}

export interface Reporter {
  readonly name: string
  /** The run began; a reporter may announce it (an in-progress check, say). */
  started?(run: RunContext): Promise<void>
  testsFinished?(run: TestRunReport): Promise<void>
  matrixFinished?(run: MatrixRunReport): Promise<void>
  /** The run stopped before it had a result (an environment that would not start, say). */
  aborted?(run: RunContext & { readonly error: string }): Promise<void>
}

/** What every run command takes besides its own selection: where, how to record, who to tell. */
export interface RunCommandOptions {
  readonly cwd?: string
  readonly config?: string
  /** Flight recorder mode; overrides the config's `record`. */
  readonly record?: RecordMode
  /** When a kept record keeps video; overrides the config's `video`. */
  readonly video?: VideoMode
  /** How many of the newest runs keep their recordings; overrides the config's `record.keepRuns`. */
  readonly keepRuns?: number
  /** Rewrite every `toHaveScreenshot` baseline (`--update-snapshots`). */
  readonly updateScreenshots?: boolean
  /** Reporters besides the config's, e.g. from `--reporter`. */
  readonly reporters?: readonly Reporter[]
  /** `--lint` / `--no-lint`: run the integration lint; absent follows the config (on by default). */
  readonly lint?: boolean
  readonly write?: (line: string) => void
}

/** Calls `hook` on every reporter, turning a failure into a warning line. */
export async function tellReporters(
  reporters: readonly Reporter[],
  hook: (reporter: Reporter) => Promise<void> | undefined,
  write: (line: string) => void,
): Promise<void> {
  for (const reporter of reporters) {
    try {
      await hook(reporter)
    } catch (error) {
      write(
        `warning: reporter ${reporter.name} failed: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }
}
