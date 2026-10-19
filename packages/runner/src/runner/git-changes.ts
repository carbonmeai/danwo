/** The files a change touched, from git: what `danwo test --changed` starts from. */
import { execFile } from "node:child_process"
import { join, relative } from "node:path"
import { promisify } from "node:util"

import { DanwoError } from "../support/codes.ts"

const run = promisify(execFile)

async function git(root: string, args: readonly string[]): Promise<string[]> {
  try {
    const { stdout } = await run("git", ["-C", root, ...args], { maxBuffer: 16 * 1024 * 1024 })

    return stdout.split("\n").filter((line) => line !== "")
  } catch (error) {
    throw new DanwoError(
      "CONFIG_INVALID",
      `--changed needs a git repository: git ${args.join(" ")} failed: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`,
    )
  }
}

/** The commit checked out in `root`, or undefined outside a git repository. */
export async function headCommit(root: string): Promise<string | undefined> {
  try {
    const { stdout } = await run("git", ["-C", root, "rev-parse", "HEAD"])

    return stdout.trim() || undefined
  } catch {
    return undefined
  }
}

/**
 * Files changed since `since` (committed or not) plus untracked ones, relative to `root`, leaving
 * out danwo's own `.danwo/` folder. Files
 * outside `root` keep their `../` paths: no test of the project explains them, so they select
 * every test unless an `impact` rule names them.
 */
export async function changedFiles(root: string, since: string): Promise<string[]> {
  const [top] = await git(root, ["rev-parse", "--show-toplevel"])

  if (top === undefined) return []

  const changed = await git(root, ["diff", "--name-only", since])
  const untracked = await git(root, ["ls-files", "--others", "--exclude-standard", "--full-name"])
  const files = new Set([...changed, ...untracked].map((file) => relative(root, join(top, file))))

  /* danwo's own output (runs, results, the impact index) is never a change to the app. */
  return [...files].filter((file) => !file.startsWith(".danwo/")).toSorted()
}
