/**
 * Finding a project's tests: which files match, what each declares, and the id that names a test
 * in every process and run (`file › describe › title`).
 */
import { relative, resolve } from "node:path"
import { pathToFileURL } from "node:url"

import { findTestFiles } from "../tests/discover.ts"
import { declarationsOf, type DeclaredTest, type FileDeclarations } from "../tests/registry.ts"
import type { LoadedConfig } from "./config.ts"

const DEFAULT_TEST_MATCH = ["**/*.danwo.ts"]

/** A test as the parent knows it: enough to select, schedule and describe it. */
export interface CatalogEntry {
  readonly id: string
  readonly file: string
  readonly mode: DeclaredTest["mode"]
  /** Whether it declares `test(...).invariant(fn)`. */
  readonly invariant: boolean
}

export function testIdOf(
  root: string,
  file: string,
  test: Pick<DeclaredTest, "titlePath">,
): string {
  return [relative(root, file), ...test.titlePath].join(" › ")
}

let loads = 0

/**
 * Loads a test file as a module instance of its own, so a retry starts from fresh module state,
 * and returns what it declared.
 */
export function loadTestFile(file: string): Promise<FileDeclarations> {
  loads += 1

  const url = new URL(pathToFileURL(file))

  url.searchParams.set("danwo-realm", `${process.pid}-${loads}`)

  return declarationsOf(() => import(url.href))
}

/** The project's test files, narrowed to those whose path contains one of `patterns`. */
export function testFilesOf(loaded: LoadedConfig, patterns: readonly string[] = []): string[] {
  const dir = resolve(loaded.root, loaded.config.testDir ?? ".")
  const files = findTestFiles(dir, loaded.config.testMatch ?? DEFAULT_TEST_MATCH).map((file) =>
    resolve(dir, file),
  )

  return patterns.length === 0
    ? files
    : files.filter((file) => patterns.some((pattern) => file.includes(pattern)))
}

/** Every test of `files`; only the `only` ones when any exist; then those whose id `grep` matches. */
export async function catalogOf(
  loaded: LoadedConfig,
  files: readonly string[],
  grep: RegExp | undefined,
): Promise<CatalogEntry[]> {
  const entries: CatalogEntry[] = []

  for (const file of files) {
    for (const test of (await loadTestFile(file)).tests) {
      entries.push({
        id: testIdOf(loaded.root, file, test),
        file,
        mode: test.mode,
        invariant: test.invariant !== undefined,
      })
    }
  }

  const focused = entries.some((entry) => entry.mode === "only")
    ? entries.filter((entry) => entry.mode === "only")
    : entries

  return grep === undefined ? focused : focused.filter((entry) => grep.test(entry.id))
}
