/**
 * Every test in the project, one row each: what it did the last time it ran, how often it passes,
 * what the fault matrix made of it, and a picture of its latest kept recording. Tests the project
 * has but that never ran are listed too, so the page is the whole suite rather than its history.
 */
import { join } from "node:path"

import type { FlightRecord, MatrixHistory, RunHistory } from "@danwo/runner/runner"

import { insideArea, isVersioned, readJson } from "../../lib/project-files.ts"
import { type TestBreakdown, testBreakdown } from "../insights/test-breakdown.ts"
import type { KnownTest } from "../live/launch-args.ts"
import { mediaUrl } from "../record/record-replay.ts"
import { BROKE, type MatrixVerdict, matrixVerdict } from "./matrix-verdict.ts"

/** A picture of a kept recording: a frame of its video, else its last screenshot. */
export interface Thumb {
  readonly dir: string
  readonly video?: string
  readonly screenshot?: string
}

export interface TestRow {
  readonly id: string
  readonly file?: string
  /** The latest run's verdict and when it started; absent for a test that never ran. */
  readonly last?: { readonly status: string; readonly at: string; readonly runId: string }
  readonly runs: number
  readonly passRate: number | null
  readonly flakeRate: number | null
  readonly matrix: MatrixVerdict
  readonly thumb?: Thumb
}

/** The record folders a run kept for the test, newest attempt or failing trial first. */
function recordsOf(run: RunHistory, testId: string): string[] {
  if (run.kind === "matrix") {
    if (run.testId !== testId) return []

    const trials = [run.clean, ...run.trials].toSorted(
      (a, b) => Number(BROKE.has(b.status)) - Number(BROKE.has(a.status)),
    )

    return trials.flatMap((trial) => (trial.record === undefined ? [] : [trial.record]))
  }

  const test = run.tests.find((seen) => seen.id === testId)

  return (test?.attempts ?? []).toReversed().flatMap((a) => (a.record ? [a.record] : []))
}

function isRecord(value: unknown): value is FlightRecord {
  return isVersioned(value) && "steps" in value && Array.isArray(value.steps)
}

/** The kept record in `dir`, or undefined once its run was pruned. */
async function readRecord(root: string, dir: string): Promise<FlightRecord | undefined> {
  try {
    const record = await readJson(join(insideArea(root, "runs", dir), "record.json"))

    return isRecord(record) ? record : undefined
  } catch {
    return undefined
  }
}

function thumbOf(dir: string, record: FlightRecord): Thumb {
  const video = record.videos?.[0]
  const screenshot = record.steps.findLast((step) => step.screenshot !== undefined)?.screenshot

  return {
    dir,
    ...(video !== undefined && { video: mediaUrl(dir, video.file) }),
    ...(screenshot !== undefined && { screenshot }),
  }
}

/** The newest kept record of the test that is still on disk, as a thumbnail. */
async function latestThumb(
  root: string,
  runs: readonly RunHistory[],
  testId: string,
): Promise<Thumb | undefined> {
  for (const dir of runs.flatMap((run) => recordsOf(run, testId))) {
    const record = await readRecord(root, dir)

    if (record) return thumbOf(dir, record)
  }

  return undefined
}

/** The newest run that ran the test, with the test's verdict in it. */
function lastOf(runs: readonly RunHistory[], testId: string): TestRow["last"] {
  for (const run of runs) {
    if (run.kind === "matrix" && run.testId === testId)
      return { status: run.clean.status, at: run.startedAt, runId: run.id }

    const test = run.kind === "test" ? run.tests.find((seen) => seen.id === testId) : undefined

    if (test) return { status: test.status, at: run.startedAt, runId: run.id }
  }

  return undefined
}

/** What is known of one test, gathered from the history and the project's list. */
interface Known {
  readonly seen: TestBreakdown | undefined
  readonly file: string | undefined
  readonly last: TestRow["last"]
  readonly matrix: MatrixVerdict
  readonly thumb: Thumb | undefined
}

/** How often the test ran, and how often it passed and flaked, from its breakdown. */
function ratesOf(
  seen: TestBreakdown | undefined,
): Pick<TestRow, "runs" | "passRate" | "flakeRate"> {
  if (seen === undefined) return { runs: 0, passRate: null, flakeRate: null }

  return { runs: seen.runs + seen.matrixRuns, passRate: seen.passRate, flakeRate: seen.flakeRate }
}

function rowOf(id: string, { seen, file, last, matrix, thumb }: Known): TestRow {
  return {
    id,
    ...(file !== undefined && { file }),
    ...(last !== undefined && { last }),
    ...ratesOf(seen),
    matrix,
    ...(thumb !== undefined && { thumb }),
  }
}

/** Every test, from the history (`runs`, newest first) and the project's own list, by id. */
export async function listTests(
  root: string,
  runs: readonly RunHistory[],
  known: readonly KnownTest[],
): Promise<TestRow[]> {
  const breakdown = new Map(testBreakdown(runs).map((row) => [row.id, row]))
  const files = new Map(known.map((test) => [test.id, test.file]))
  const ids = [...new Set([...known.map((test) => test.id), ...breakdown.keys()])]
  const matrices = runs.filter((run): run is MatrixHistory => run.kind === "matrix")
  const ofTest = (id: string) => matrices.filter((run) => run.testId === id)

  const rows = await Promise.all(
    ids.map(async (id) =>
      rowOf(id, {
        seen: breakdown.get(id),
        file: files.get(id) ?? ofTest(id)[0]?.file,
        last: lastOf(runs, id),
        matrix: matrixVerdict(ofTest(id)),
        thumb: await latestThumb(root, runs, id),
      }),
    ),
  )

  return rows.toSorted((a, b) => a.id.localeCompare(b.id))
}
