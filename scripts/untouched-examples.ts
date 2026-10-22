/**
 * A test run's guard: the examples and the test fixtures are the repository's own, so a run must leave
 * them as it found them. Tests work on throwaway copies (`.work-*`, see `packages/cli/test/work-copy.ts`);
 * anything else a run adds or changes under these folders, flight records in `.danwo/` included, fails it.
 */
import { execFileSync } from "node:child_process"
import { existsSync, readdirSync, rmSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = fileURLToPath(new URL("..", import.meta.url))
const WATCHED = ["examples", ":(glob)packages/*/test/fixtures/**"]

/** A copy `workCopy()` made: `.work-<name>-<pid>-<random>`, with the pid of the worker that made it. */
const COPY = /^\.work-.+-(\d+)-[a-z0-9]{6}$/

/** Every changed, untracked or ignored path under the watched folders, apart from installed packages and work copies. */
function touched(): Set<string> {
  const out = execFileSync(
    "git",
    [
      "status",
      "--porcelain",
      "--ignored",
      "--untracked-files=all",
      "--",
      ...WATCHED,
      /* An example installed in place has a node_modules far too big to list. */
      ":(exclude,glob)**/node_modules/**",
    ],
    { cwd: ROOT, encoding: "utf8" },
  )

  return new Set(
    out
      .split("\n")
      .filter(Boolean)
      .filter((line) => !/(^|\/)(node_modules|\.work-[^/]*)(\/|$)/.test(line.slice(3))),
  )
}

/** Whether the process `pid` is still running. */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)

    return true
  } catch {
    return false
  }
}

/** The folders copies are made in: beside each example and each package's test fixtures. */
function copyFolders(): string[] {
  const fixtures = readdirSync(join(ROOT, "packages")).map((name) =>
    join(ROOT, "packages", name, "test", "fixtures"),
  )

  return [join(ROOT, "examples"), ...fixtures].filter((folder) => existsSync(folder))
}

/** Whether `entry` is a copy whose worker has ended, so nothing is using it any more. */
function abandoned(entry: string): boolean {
  const pid = COPY.exec(entry)?.[1]

  return pid !== undefined && !alive(Number(pid))
}

/**
 * Deletes the copies whose worker has ended. A test file that fails to load, or whose tests are all
 * skipped, never runs its `afterAll`; a copy another run is still using is left alone.
 */
function sweepCopies(): void {
  for (const folder of copyFolders())
    for (const entry of readdirSync(folder).filter(abandoned))
      rmSync(join(folder, entry), { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
}

/** Notes what is already there, then fails the run if it added to it. */
export default function setup(): () => void {
  const before = touched()

  return () => {
    sweepCopies()

    const added = [...touched()].filter((line) => !before.has(line))

    if (added.length > 0)
      throw new Error(
        `the test run wrote into the examples or fixtures; use workCopy() instead:\n  ${added.join("\n  ")}`,
      )
  }
}
