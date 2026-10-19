/**
 * One test as its page shows it: every run of it, plain and under the matrix; every recording of
 * it still on disk, to pick which one the player shows; its latest matrix run; and the recording
 * picked, in full.
 */
import type { MatrixHistory, RunHistory } from "@danwo/runner/runner"

import { type RecordView, getRecord } from "../record/record-data.ts"
import { type MatrixVerdict, matrixVerdict, readRecord, recordsOf } from "./tests-data.ts"

/** One run of the test, as its history lists it. */
export interface TestRunEntry {
  readonly runId: string
  readonly kind: "test" | "matrix"
  readonly startedAt: string
  readonly durationMs: number
  /** The test's verdict: in a test run its status, in a matrix run the clean run's. */
  readonly status: string
  /** How many times it was tried, in a test run; how many faults broke it, in a matrix run. */
  readonly retries: number
  readonly broke: number
  readonly faults: number
}

/** A recording the player can show, with what it was a recording of. */
export interface RecordingChoice {
  readonly dir: string
  readonly runId: string
  readonly kind: "test" | "matrix"
  readonly startedAt: string
  readonly status: string
  /** The fault a matrix trial ran under; absent for a test run and the clean run. */
  readonly fault?: string
  /** Which try of the run it was, from 1; only told apart when the test was retried. */
  readonly attempt?: number
}

export interface TestView {
  readonly id: string
  readonly file?: string
  readonly entries: readonly TestRunEntry[]
  readonly recordings: readonly RecordingChoice[]
  readonly matrix?: MatrixHistory
  readonly verdict: MatrixVerdict
  /** The recording on show, or null when none was kept. */
  readonly record: RecordView | null
}

const BROKE = new Set(["failed", "timed-out", "interrupted"])

function entryOf(run: RunHistory, id: string): TestRunEntry | undefined {
  if (run.kind === "matrix")
    return run.testId === id
      ? {
          runId: run.id,
          kind: "matrix",
          startedAt: run.startedAt,
          durationMs: run.durationMs,
          status: run.clean.status,
          retries: 0,
          broke: run.trials.filter((trial) => BROKE.has(trial.status)).length,
          faults: run.trials.length,
        }
      : undefined

  const test = run.tests.find((seen) => seen.id === id)

  if (test === undefined) return undefined

  return {
    runId: run.id,
    kind: "test",
    startedAt: run.startedAt,
    durationMs: test.attempts.reduce((sum, attempt) => sum + attempt.durationMs, 0),
    status: test.status,
    retries: Math.max(0, test.attempts.length - 1),
    broke: 0,
    faults: 0,
  }
}

/** The recordings a run kept of the test, each with what it recorded. */
function choicesOf(run: RunHistory, id: string): RecordingChoice[] {
  const base = { runId: run.id, kind: run.kind, startedAt: run.startedAt }

  if (run.kind === "matrix") {
    const trials = [run.clean, ...run.trials]

    return recordsOf(run, id).flatMap((dir) => {
      const trial = trials.find((seen) => seen.record === dir)

      return trial
        ? [{ ...base, dir, status: trial.status, ...(trial.fault && { fault: trial.fault }) }]
        : []
    })
  }

  const attempts = run.tests.find((seen) => seen.id === id)?.attempts ?? []

  return attempts
    .flatMap((attempt, i) =>
      attempt.record === undefined
        ? []
        : [
            {
              ...base,
              dir: attempt.record,
              status: attempt.status,
              ...(attempts.length > 1 && { attempt: i + 1 }),
            },
          ],
    )
    .toReversed()
}

/** The test `id` from the history (`runs`, newest first), showing the recording in `dir`. */
export async function getTest(
  root: string,
  runs: readonly RunHistory[],
  id: string,
  file: string | undefined,
  dir?: string,
): Promise<TestView> {
  const entries = runs.flatMap((run) => entryOf(run, id) ?? [])
  const matrices = runs.filter(
    (run): run is MatrixHistory => run.kind === "matrix" && run.testId === id,
  )
  const offered = runs.flatMap((run) => choicesOf(run, id))
  const kept = await Promise.all(
    offered.map(async (choice) => (await readRecord(root, choice.dir)) !== undefined),
  )
  const recordings = offered.filter((_, i) => kept[i])
  const shown =
    dir ?? recordings.find((choice) => choice.kind === "test")?.dir ?? recordings[0]?.dir
  const record =
    shown === undefined ? undefined : await getRecord(root, shown).catch(() => undefined)
  const matrix = matrices[0]
  const source = file ?? matrix?.file

  return {
    id,
    ...(source !== undefined && { file: source }),
    entries,
    recordings,
    ...(matrix !== undefined && { matrix }),
    verdict: matrixVerdict(matrices),
    record: record ?? null,
  }
}
