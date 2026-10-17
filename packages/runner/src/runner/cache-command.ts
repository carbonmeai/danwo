/**
 * `danwo cache ls|stats|clear`: what the project's replay cache holds. Each recording file keeps
 * the parts of its key, so recordings are listed by journey (the test that made them) and step.
 */
import { readdir, rm, stat } from "node:fs/promises"
import { join, relative, resolve } from "node:path"

import { readStored } from "../replay/store.ts"
import { DanwoError } from "../support/codes.ts"
import { loadConfig } from "./config.ts"

export type CacheAction = "ls" | "stats" | "clear"

export interface CacheCommandOptions {
  readonly cwd?: string
  readonly config?: string
  /** Only recordings of this journey (a test id). */
  readonly journey?: string
  readonly write?: (line: string) => void
}

/** One recording file, as the cache lists it. */
interface Entry {
  readonly file: string
  readonly bytes: number
  readonly journey: string
  readonly step: number | undefined
  readonly kind: string
  readonly instruction: string
  readonly recordedAt: string
}

const printLine = (line: string) => process.stdout.write(`${line}\n`)

/** Every recording in `dir`; files without a key's parts belong to journey "(unknown)". */
async function entriesOf(dir: string): Promise<Entry[]> {
  const names = await readdir(dir).catch(() => [])
  const entries: Entry[] = []

  for (const name of names.filter((file) => file.endsWith(".json"))) {
    const file = join(dir, name)
    const stored = await readStored(file)

    if (stored === undefined) continue

    entries.push({
      file,
      bytes: (await stat(file)).size,
      journey: stored.identity?.journey ?? "(unknown)",
      step: stored.identity?.step,
      kind: stored.identity?.kind ?? "act",
      instruction: stored.instruction,
      recordedAt: stored.recordedAt,
    })
  }

  return entries.toSorted(
    (a, b) => a.journey.localeCompare(b.journey) || (a.step ?? 0) - (b.step ?? 0),
  )
}

function listLines(entries: readonly Entry[]): string[] {
  return entries.map(
    (entry) =>
      `${entry.journey}  #${entry.step ?? "?"} ${entry.kind}  ${JSON.stringify(entry.instruction)}  ${entry.recordedAt.slice(0, 19)}`,
  )
}

function statsLines(entries: readonly Entry[], dir: string): string[] {
  const byJourney = Map.groupBy(entries, (entry) => entry.journey)
  const bytes = entries.reduce((sum, entry) => sum + entry.bytes, 0)
  const dates = entries.map((entry) => entry.recordedAt).toSorted()

  return [
    `${dir}: ${entries.length} recordings in ${byJourney.size} journeys, ${(bytes / 1024).toFixed(1)} KiB`,
    ...(dates.length > 0
      ? [`oldest ${dates[0]?.slice(0, 19)}, newest ${dates.at(-1)?.slice(0, 19)}`]
      : []),
    ...[...byJourney].map(([journey, list]) => `  ${String(list.length).padStart(4)}  ${journey}`),
  ]
}

/** The recordings an action works on, and where they live as the user sees it. */
interface Selection {
  readonly entries: readonly Entry[]
  readonly shown: string
}

/** What each action does with the selected recordings, as the lines it prints. */
const ACTIONS: Readonly<Record<CacheAction, (selection: Selection) => Promise<string[]>>> = {
  ls: async ({ entries }) => listLines(entries),
  stats: async ({ entries, shown }) => statsLines(entries, shown),
  clear: async ({ entries, shown }) => {
    for (const entry of entries) await rm(entry.file, { force: true })

    return [`removed ${entries.length} recordings from ${shown}`]
  },
}

/** The project's cache folder; a config without `cache` has none. */
async function cacheDir(cwd: string, config: string | undefined): Promise<string> {
  const loaded = await loadConfig(cwd, config)
  const cache = loaded.config.cache

  if (cache === undefined)
    throw new DanwoError(
      "CONFIG_INVALID",
      "the config sets no `cache`, so there is no replay cache",
    )

  return resolve(loaded.root, cache.dir)
}

/** Runs a cache action; resolves to the exit code. */
export async function runCache(
  action: CacheAction,
  options: CacheCommandOptions = {},
): Promise<number> {
  const cwd = options.cwd ?? process.cwd()
  const write = options.write ?? printLine
  const dir = await cacheDir(cwd, options.config)
  const all = await entriesOf(dir)
  const entries =
    options.journey === undefined ? all : all.filter((entry) => entry.journey === options.journey)

  for (const line of await ACTIONS[action]({ entries, shown: relative(cwd, dir) || "." }))
    write(line)

  return 0
}
