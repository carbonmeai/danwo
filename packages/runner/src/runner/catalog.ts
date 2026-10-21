/**
 * Finding a project's tests: which files match, what each declares, and the id that names a test
 * in every process and run (`file › describe › title`).
 */
import { relative, resolve } from "node:path"
import { pathToFileURL } from "node:url"

import { DanwoError } from "../support/codes.ts"
import { findTestFiles } from "../tests/discover.ts"
import { declarationsOf, type DeclaredTest, type FileDeclarations } from "../tests/registry.ts"
import type { LoadedConfig } from "./config.ts"
import { explainLoadError } from "./load-errors.ts"

const DEFAULT_TEST_MATCH = ["**/*.danwo.ts"]

/** A test as the parent knows it: enough to select, schedule and describe it. */
export interface CatalogEntry {
  readonly id: string
  readonly file: string
  readonly mode: DeclaredTest["mode"]
  /** Whether it declares `test(...).invariant(fn)`. */
  readonly invariant: boolean
  /** Its `concurrent` option: how many people `danwo matrix` may run it by at once. */
  readonly concurrent?: number
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

  return declarationsOf(() =>
    import(url.href).catch((error: unknown) => {
      throw explainLoadError(error, file, "test")
    }),
  )
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

/** Refuses a file that focuses tests with `.only`, naming where, for runs that must run everything. */
function refuseFocus(loaded: LoadedConfig, file: string, declarations: FileDeclarations): void {
  const focused = declarations.tests.some((test) => test.mode === "only")

  if (!focused) return

  const where = declarations.focusLines.map((line) => `${relative(loaded.root, file)}:${line}`)

  throw new DanwoError(
    "CONFIG_INVALID",
    `.only is not allowed in CI (it would skip the rest of the suite): ${where.join(", ") || relative(loaded.root, file)}`,
  )
}

/**
 * Every test of `files`; only the `only` ones when any exist; then those whose id `grep` matches.
 * With `forbidOnly`, a file that uses `.only` is refused instead.
 */
export async function catalogOf(
  loaded: LoadedConfig,
  files: readonly string[],
  grep: RegExp | undefined,
  forbidOnly = false,
): Promise<CatalogEntry[]> {
  const entries: CatalogEntry[] = []

  for (const file of files) {
    const declarations = await loadTestFile(file)

    if (forbidOnly) refuseFocus(loaded, file, declarations)

    for (const test of declarations.tests) {
      entries.push({
        id: testIdOf(loaded.root, file, test),
        file,
        mode: test.mode,
        invariant: test.invariant !== undefined,
        ...(test.options.concurrent !== undefined && { concurrent: test.options.concurrent }),
      })
    }
  }

  const focused = entries.some((entry) => entry.mode === "only")
    ? entries.filter((entry) => entry.mode === "only")
    : entries

  return grep === undefined ? focused : focused.filter((entry) => grep.test(entry.id))
}
