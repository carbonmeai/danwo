/**
 * Reading the flight recorder's runs from disk: a run's records, one record, and the facts tools
 * report from them. Records are redacted when they are written, so what is read here is safe to
 * return.
 */
import { readdir, readFile } from "node:fs/promises"
import { join, relative } from "node:path"

import { findRun, type FlightRecord, type RecordedStep, runsDir } from "@danwo/runner/runner"

import type { Project } from "./project.ts"

/** A record and its directory, relative to the project root. */
export interface LoadedRecord {
  readonly dir: string
  readonly record: FlightRecord
}

export interface LoadedRun {
  readonly id: string
  /** The run's directory, relative to the project root. */
  readonly dir: string
  readonly records: readonly LoadedRecord[]
}

/** A record this version of danwo wrote: the recorder's own output, so its version is the check. */
function isFlightRecord(value: unknown): value is FlightRecord {
  return typeof value === "object" && value !== null && "version" in value && value.version === 1
}

async function subdirectories(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])

  return entries.filter((entry) => entry.isDirectory()).map((entry) => join(dir, entry.name))
}

async function readRecord(dir: string): Promise<FlightRecord | undefined> {
  const parsed: unknown = await readFile(join(dir, "record.json"), "utf8")
    .then((text) => JSON.parse(text))
    .catch(() => undefined)

  return isFlightRecord(parsed) ? parsed : undefined
}

/** A run's records, oldest first; `runId` names one, else the newest run. */
export async function loadRun(project: Project, runId?: string): Promise<LoadedRun | undefined> {
  const dir = await findRun(runsDir(project.root), runId)

  if (dir === undefined) return undefined

  const recordDirs = (await Promise.all((await subdirectories(dir)).map(subdirectories))).flat()
  const loaded = await Promise.all(
    recordDirs.map(async (recordDir) => ({ dir: recordDir, record: await readRecord(recordDir) })),
  )
  const records = loaded
    .filter((item): item is LoadedRecord => item.record !== undefined)
    .map((item) => ({ ...item, dir: project.relative(item.dir) }))
    .toSorted((a, b) => a.record.startedAt.localeCompare(b.record.startedAt))

  return { id: relative(runsDir(project.root), dir), dir: project.relative(dir), records }
}

/** One record by its directory, which must lie under the project's runs. */
export async function loadRecord(project: Project, recordDir: string): Promise<LoadedRecord> {
  const dir = project.inside(recordDir)

  if (relative(runsDir(project.root), dir).startsWith("..")) {
    throw new Error(
      `${recordDir} is not a flight record under ${project.relative(runsDir(project.root))}`,
    )
  }

  const record = await readRecord(dir)

  if (record === undefined) throw new Error(`no flight record in ${recordDir}`)

  return { dir: project.relative(dir), record }
}

/** How many times the run called a model. */
export function modelCalls(record: FlightRecord): number {
  return record.steps.reduce(
    (total, step) => total + step.events.filter((event) => event.kind === "model").length,
    0,
  )
}

/** The step the run failed at: the last failed one. */
export function failingStep(record: FlightRecord): RecordedStep | undefined {
  return record.steps.findLast((step) => step.status === "failed")
}

/** What the record is a run of: an attempt of a test, or a matrix run with its fault. */
export function runLabel(record: FlightRecord): string {
  if (record.run.kind === "test") return `attempt ${record.run.attempt}`

  return record.run.fault === null ? "clean run" : record.run.fault.label
}
