/** `danwo impact <files…>`: which tests a change to these files selects, and why. */
import { relative, resolve } from "node:path"

import { type CatalogEntry, catalogOf, testFilesOf } from "./catalog.ts"
import { type LoadedConfig, loadConfig } from "./config.ts"
import { localImportsOf, readImpactIndex, selectImpacted, selectionLines } from "./impact.ts"

export interface ImpactCommandOptions {
  readonly cwd?: string
  readonly config?: string
  /** Changed files, relative to the cwd. */
  readonly files: readonly string[]
  readonly write?: (line: string) => void
}

const printLine = (line: string) => process.stdout.write(`${line}\n`)

/**
 * The entries `changes` (relative to the project root) can affect, after printing why, and the
 * `danwo matrix` runs worth doing: selected tests that declare an invariant.
 */
export async function chooseByChanges(
  loaded: LoadedConfig,
  entries: readonly CatalogEntry[],
  changes: readonly string[],
  write: (line: string) => void,
): Promise<CatalogEntry[]> {
  const tests = entries.map((entry) => ({
    id: entry.id,
    file: relative(loaded.root, entry.file),
    imports: localImportsOf(entry.file, loaded.root),
  }))
  const selection = selectImpacted(changes, {
    tests,
    index: await readImpactIndex(loaded.root),
    config: loaded.config.impact ?? {},
  })

  for (const line of selectionLines(selection, entries.length)) write(line)

  const chosen = selection.all ? [...entries] : entries.filter((e) => selection.reasons.has(e.id))

  for (const file of new Set(chosen.filter((e) => e.invariant).map((e) => e.file))) {
    write(`matrix: danwo matrix ${relative(loaded.root, file)}`)
  }

  return chosen
}

/** Explains the selection for `files`; resolves to 0. */
export async function explainImpact(options: ImpactCommandOptions): Promise<number> {
  const cwd = options.cwd ?? process.cwd()
  const loaded = await loadConfig(cwd, options.config)
  const entries = await catalogOf(loaded, testFilesOf(loaded), undefined)
  const changes = options.files.map((file) => relative(loaded.root, resolve(cwd, file)))

  await chooseByChanges(loaded, entries, changes, options.write ?? printLine)

  return 0
}
