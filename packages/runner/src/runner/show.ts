import { spawn } from "node:child_process"
import { join, relative } from "node:path"

import { loadConfig } from "./config.ts"
import { failurePage } from "./failure-page.ts"
import { runsDir } from "./record.ts"
import { findRun, loadRecords } from "./report.ts"

export interface ShowRunOptions {
  readonly cwd?: string
  readonly config?: string
  /** A run directory's name under `.danwo/runs`; default the newest. */
  readonly runId?: string
  /** Opens the report in the default browser as well. */
  readonly open?: boolean
  /** `html` (default) prints the report's path; `md` prints a failure page for each failed run. */
  readonly format?: "html" | "md"
  readonly write?: (line: string) => void
}

const OPENER: Readonly<Record<string, string>> = { darwin: "open", win32: "explorer" }

/** Every failed record of the run as Markdown pages, separated by rules. */
async function failurePages(run: string): Promise<string> {
  const failed = (await loadRecords(run)).filter(({ record }) => record.status !== "passed")

  if (failed.length === 0) return "No failed runs in this recording.\n"

  return failed
    .map(({ record, dir, screen }) => `${failurePage(record, screen)}\nrecord: ${dir}\n`)
    .join("\n---\n\n")
}

/**
 * `danwo show`: prints (and with `open`, opens) a recorded run's report, or with `format: "md"`
 * its failures as Markdown. Resolves to the exit code.
 */
export async function showRun(options: ShowRunOptions = {}): Promise<number> {
  const cwd = options.cwd ?? process.cwd()
  const write = options.write ?? ((line: string) => process.stdout.write(`${line}\n`))
  const loaded = await loadConfig(cwd, options.config)
  const run = await findRun(runsDir(loaded.root), options.runId)

  if (run === undefined) {
    write(options.runId ? `no recorded run ${options.runId}` : "no recorded runs yet")

    return 1
  }

  if (options.format === "md") {
    write(await failurePages(run))

    return 0
  }

  const report = join(run, "report.html")

  write(relative(cwd, report))

  if (options.open) {
    spawn(OPENER[process.platform] ?? "xdg-open", [report], {
      detached: true,
      stdio: "ignore",
    }).unref()
  }

  return 0
}
