import { spawn } from "node:child_process"
import { join, relative } from "node:path"

import { loadConfig } from "./config.ts"
import { runsDir } from "./record.ts"
import { findRun } from "./report.ts"

export interface ShowRunOptions {
  readonly cwd?: string
  readonly config?: string
  /** A run directory's name under `.danwo/runs`; default the newest. */
  readonly runId?: string
  /** Opens the report in the default browser as well. */
  readonly open?: boolean
  readonly write?: (line: string) => void
}

const OPENER: Readonly<Record<string, string>> = { darwin: "open", win32: "explorer" }

/** `danwo show`: prints (and with `open`, opens) a recorded run's report. Resolves to the exit code. */
export async function showRun(options: ShowRunOptions = {}): Promise<number> {
  const cwd = options.cwd ?? process.cwd()
  const write = options.write ?? ((line: string) => process.stdout.write(`${line}\n`))
  const loaded = await loadConfig(cwd, options.config)
  const run = await findRun(runsDir(loaded.root), options.runId)

  if (run === undefined) {
    write(options.runId ? `no recorded run ${options.runId}` : "no recorded runs yet")

    return 1
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
