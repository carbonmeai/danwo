/**
 * Throwaway copies of the examples and fixtures, so a test run never writes into the repository's own
 * folders: flight records, replay caches, snapshots and generated tests land in the copy and go with it.
 */
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, symlinkSync } from "node:fs"
import { basename, dirname, join } from "node:path"

/** What a copy leaves out: installed packages (linked instead) and what earlier runs wrote. */
const LEFT_OUT = new Set(["node_modules", ".danwo", "test-results", "playwright-report"])

const copies = new Map<string, string>()

/**
 * A copy of the folder `source`, made beside it as `.work-<name>-<pid>-<random>` so its relative imports
 * and package resolution behave as in the original. Its `node_modules` is linked, not copied. One copy per
 * source for the whole test file, as tests in a file shared the original; {@link removeWorkCopies} deletes them.
 */
export function workCopy(source: string): string {
  const known = copies.get(source)

  if (known !== undefined) return known

  const copy = join(
    dirname(source),
    `.work-${basename(source)}-${process.pid}-${Math.random().toString(36).slice(2, 8)}`,
  )

  mkdirSync(copy)

  for (const entry of readdirSync(source)) {
    if (LEFT_OUT.has(entry) || entry.startsWith(".work-")) continue
    cpSync(join(source, entry), join(copy, entry), { recursive: true })
  }

  if (existsSync(join(source, "node_modules")))
    symlinkSync(join(source, "node_modules"), join(copy, "node_modules"), "dir")

  copies.set(source, copy)

  return copy
}

/**
 * Deletes every copy {@link workCopy} made in this test file. A process the test just stopped
 * may still be writing into the copy, so a busy directory is retried rather than failing.
 */
export function removeWorkCopies(): void {
  for (const copy of copies.values())
    rmSync(copy, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  copies.clear()
}
