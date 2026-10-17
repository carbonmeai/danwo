import { globSync } from "node:fs"
import { relative, resolve, sep } from "node:path"

/** Folders never searched for tests: dependencies, and the baselines screenshot checks keep. */
const SKIPPED = new Set(["node_modules", "__screenshots__"])

function skipped(name: string): boolean {
  return SKIPPED.has(name.split("/").at(-1) ?? name)
}

/**
 * Test files under `dir` matching any of `patterns`, relative to `dir`, sorted. Only files count:
 * a folder whose name looks like a test file (a baselines folder is named after its test file) is
 * not one.
 */
export function findTestFiles(dir: string, patterns: readonly string[]): string[] {
  const found = globSync([...patterns], {
    cwd: dir,
    withFileTypes: true,
    exclude: (entry) => skipped(entry.name),
  })
  const files = found
    .filter((entry) => entry.isFile())
    .map((entry) =>
      relative(resolve(dir), resolve(entry.parentPath, entry.name)).split(sep).join("/"),
    )

  return [...new Set(files)].toSorted()
}
