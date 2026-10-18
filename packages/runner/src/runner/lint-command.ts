/*
 * `danwo lint`: runs the integration lint again over a recorded run's flight records, with the
 * current rules and config. A run keeps records for failures by default; record every run with
 * `--record always` to lint passing runs too.
 */
import { type LintConfig, type LintFinding, lint, lintReport, withLint } from "../lint/index.ts"
import { loadConfig } from "./config.ts"
import { type FlightRecord, runsDir } from "./record.ts"
import { findRun, loadRecords, noRun } from "./report.ts"

export interface LintRunOptions {
  readonly cwd?: string
  readonly config?: string
  /** A run directory's name under `.danwo/runs`; default the newest. */
  readonly runId?: string
  readonly write?: (line: string) => void
}

/** Which run of its test a record is: the attempt, or the matrix fault. */
function runName(run: FlightRecord["run"]): string {
  if (run.kind === "test") return `attempt ${run.attempt}`

  return run.fault?.label ?? "clean"
}

/** Lints each record of a run, naming the records that have findings; resolves to all of them. */
async function lintRecords(
  run: string,
  config: LintConfig | undefined,
  write: (line: string) => void,
): Promise<LintFinding[]> {
  const records = await loadRecords(run)
  const all = records.flatMap(({ record, dir }) => {
    const findings = lint(record, config)

    if (findings.length > 0) write(`${record.test} (${runName(record.run)}): ${dir}`)

    return findings
  })

  write(`linted ${records.length} record${records.length === 1 ? "" : "s"}`)

  return all
}

/** Lints every record of the run; resolves to the exit code (1 when findings reach `failOn`). */
export async function lintRun(options: LintRunOptions = {}): Promise<number> {
  const write = options.write ?? ((line: string) => process.stdout.write(`${line}\n`))
  const loaded = await loadConfig(options.cwd ?? process.cwd(), options.config)
  const config = loaded.config.lint === false ? {} : loaded.config.lint
  const run = await findRun(runsDir(loaded.root), options.runId)

  if (run === undefined) return noRun(write, options.runId)

  const findings = await lintRecords(run, config, write)

  for (const line of lintReport(findings)) write(line)
  if (findings.length === 0) write("integration lint: no findings")

  return withLint(0, findings, config)
}
