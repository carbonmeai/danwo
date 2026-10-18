import { spawn } from "node:child_process"
import { basename, join, relative } from "node:path"

import { loadConfig } from "./config.ts"
import { failurePage } from "./failure-page.ts"
import { runsDir } from "./record.ts"
import { findRun, loadRecords } from "./report.ts"
import { flakyIds, lastRunPath, readResults } from "./results.ts"

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

/** The tests that ended flaky in `run`, when it is the run the latest results describe. */
async function flakyIn(root: string, run: string): Promise<Set<string>> {
  const results = await readResults(lastRunPath(root))

  return results?.run === basename(run) ? flakyIds(results) : new Set()
}

/** Every failed record of the run as Markdown pages, separated by rules. */
async function failurePages(root: string, run: string): Promise<string> {
  const failed = (await loadRecords(run)).filter(({ record }) => record.status !== "passed")
  const flaky = await flakyIn(root, run)

  if (failed.length === 0) return "No failed runs in this recording.\n"

  return failed
    .map(({ record, dir, screen }) => {
      const note = flaky.has(record.test)
        ? "> flaky: this test passed on a later attempt; this page is an attempt that failed.\n\n"
        : ""

      return `${note}${failurePage(record, screen)}\nrecord: ${dir}\n`
    })
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
    write(await failurePages(loaded.root, run))

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
