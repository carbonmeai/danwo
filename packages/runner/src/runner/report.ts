/*
 * The flight recorder's runs on disk: each run's kept records, its `report.html`, and pruning of
 * old runs.
 */
import { readdir, readFile, rm, stat, writeFile } from "node:fs/promises"
import { basename, join, relative } from "node:path"

import type { FlightRecord } from "./record.ts"
import { type Loaded, renderReport } from "./report-html.ts"

/**
 * Runs kept under `.danwo/runs` unless the config's `record.keepRuns` says otherwise; older ones
 * are deleted when a run finishes.
 */
export const DEFAULT_KEEP_RUNS = 50

async function children(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])

  return entries.filter((e) => e.isDirectory()).map((e) => join(dir, e.name))
}

async function load(runDir: string, dir: string): Promise<Loaded | undefined> {
  try {
    const record: unknown = JSON.parse(await readFile(join(dir, "record.json"), "utf8"))

    if (!isFlightRecord(record)) return undefined

    const screenFile = record.failure?.screen
    const screen =
      screenFile === undefined
        ? undefined
        : await readFile(join(dir, screenFile), "utf8").catch(() => undefined)

    return { record, dir: relative(runDir, dir).split("\\").join("/"), screen }
  } catch {
    return undefined
  }
}

/** A record this version of danwo wrote; the file is its own output, so the version is the check. */
function isFlightRecord(value: unknown): value is FlightRecord {
  return typeof value === "object" && value !== null && "version" in value && value.version === 1
}

/** Every record under `runDir` (`<test>/<attempt>/record.json`), oldest first. */
export async function loadRecords(runDir: string): Promise<Loaded[]> {
  const dirs = (await Promise.all((await children(runDir)).map(children))).flat()
  const loaded = await Promise.all(dirs.map((dir) => load(runDir, dir)))

  return loaded
    .filter((l): l is Loaded => l !== undefined)
    .toSorted((a, b) => a.record.startedAt.localeCompare(b.record.startedAt))
}

/**
 * Finishes a run's recording: writes `report.html` over its records and resolves to its path, or
 * removes the run directory when nothing was kept. Prunes all but the newest runs. Never throws.
 */
export async function finishRun(
  runDir: string,
  keepRuns = DEFAULT_KEEP_RUNS,
): Promise<string | undefined> {
  try {
    const records = await loadRecords(runDir)

    if (records.length === 0) {
      await rm(runDir, { recursive: true, force: true })

      return undefined
    }

    const path = join(runDir, "report.html")

    await writeFile(path, renderReport(basename(runDir), records))
    await pruneRuns(join(runDir, ".."), keepRuns)

    return path
  } catch {
    return undefined
  }
}

/** Deletes all but the newest `keep` runs under `runsDir`; at least one, the run just finished, stays. */
export async function pruneRuns(runsDir: string, keep: number): Promise<void> {
  const runs = (await children(runsDir)).toSorted().toReversed()

  await Promise.all(
    runs.slice(Math.max(1, keep)).map((dir) => rm(dir, { recursive: true, force: true })),
  )
}

/** Says a command found no run to read (the named one, or any); resolves to its exit code, 1. */
export function noRun(write: (line: string) => void, runId: string | undefined): number {
  write(runId ? `no recorded run ${runId}` : "no recorded runs yet")

  return 1
}

/** The newest run directory under `runsDir`, or the one named `runId`; undefined when absent. */
export async function findRun(runsDir: string, runId?: string): Promise<string | undefined> {
  const runs = (await children(runsDir)).toSorted()
  const found = runId === undefined ? runs.at(-1) : runs.find((dir) => basename(dir) === runId)

  if (found === undefined) return undefined

  return (await stat(join(found, "report.html")).catch(() => undefined)) ? found : undefined
}
