/**
 * `bun run bench`: runs the benchmark and writes its results.
 *
 *   bun run bench                         locators only, no model: the correct app, the planted
 *                                         UI bugs, and `danwo matrix` on the provider bugs; agent
 *                                         and mixed styles replay their committed recordings
 *   bun run bench --live                  every style with a real model: records, then replays
 *   bun run bench --live --model openai/gpt-6-luna
 *   bun run bench --matrix-bugs no-dedupe,raw-429   only these provider bugs under the matrix
 *
 * Live runs spend money on the model (a few dollars at most) and need AI_GATEWAY_API_KEY, from the
 * environment, the repository's `.env`, or `DANWO_FIDELITY_AI_GATEWAY_KEY` in its `.env.fidelity`.
 */
import { existsSync } from "node:fs"
import { mkdir, readdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { parseArgs } from "node:util"

import type { Bug } from "../app/bugs.ts"
import { BENCH_ROOT, runMatrix, runTests, type TestRun } from "./cli.ts"
import {
  type BugRun,
  matrixMetrics,
  type MatrixRunResult,
  styleMetrics,
  type StyleRuns,
  type TestOutcome,
} from "./metrics.ts"
import { type BenchResults, summary } from "./report.ts"
import {
  fileOf,
  MATRIX_BUGS,
  MATRIX_TEST,
  type Scenario,
  SCENARIOS,
  STYLES,
  type Style,
  TEST_BUGS,
  titleOf,
} from "./scenarios.ts"

const DEFAULT_MODEL = "anthropic/claude-sonnet-5.5"

interface Options {
  readonly live: boolean
  readonly model: string
  readonly matrixBugs: readonly Bug[]
  readonly out: string
}

function optionsFrom(argv: readonly string[]): Options {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      live: { type: "boolean", default: false },
      model: { type: "string", default: DEFAULT_MODEL },
      "matrix-bugs": { type: "string" },
      out: { type: "string", default: join(BENCH_ROOT, "results") },
    },
  })
  const picked = values["matrix-bugs"]?.split(",")

  return {
    live: values.live,
    model: values.model,
    matrixBugs: MATRIX_BUGS.filter((bug) => picked === undefined || picked.includes(bug)),
    out: values.out,
  }
}

const STATUSES = ["passed", "failed", "flaky", "skipped"] as const

function isScenario(name: string): name is Scenario {
  return SCENARIOS.some((scenario) => scenario === name)
}

/** A run's tests as outcomes, by the scenario in their title. */
function outcomesOf(history: TestRun): TestOutcome[] {
  return history.tests.flatMap((test) => {
    const scenario = /› (\w+) \[/.exec(test.id)?.[1] ?? ""

    if (!isScenario(scenario)) return []

    const attempts = test.attempts

    return [
      {
        scenario,
        status: STATUSES.find((status) => status === test.status) ?? "failed",
        ms: attempts.reduce((total, attempt) => total + attempt.durationMs, 0),
        calls: attempts.reduce((total, attempt) => total + (attempt.usage?.spent.calls ?? 0), 0),
        usd: attempts.reduce((total, attempt) => total + (attempt.usage?.spent.usd ?? 0), 0),
      },
    ]
  })
}

/** Grep for exactly one test title. */
const grepFor = (title: string) => `(^| )${title.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`

async function hasRecordings(): Promise<boolean> {
  const dir = join(BENCH_ROOT, "recordings")

  return existsSync(dir) && (await readdir(dir)).length > 0
}

/** The env a run gets: the model when live, the replay-only model otherwise. */
function envFor(options: Options, extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return { BENCH_MODEL: options.live ? options.model : "", BENCH_BUGS: "", ...extra }
}

/** One style on the correct app: recorded first when live, then replayed with no model. */
async function styleRuns(style: Style, options: Options): Promise<StyleRuns | undefined> {
  const recorded = style === "locators" || (await hasRecordings())

  if (!options.live && !recorded) return undefined

  const first = options.live
    ? await runTests([fileOf(style), "--retries", "0"], envFor(options))
    : await runTests([fileOf(style), "--ci", "--retries", "0"], envFor(options))

  if (style === "locators") return { style, first: outcomesOf(first.history) }

  const replay = await runTests([fileOf(style), "--ci", "--retries", "0"], {
    BENCH_MODEL: "",
    BENCH_BUGS: "",
  })

  return { style, first: outcomesOf(first.history), replay: outcomesOf(replay.history) }
}

/** Each planted UI bug against each style's test of the scenario it breaks. */
async function bugRuns(styles: readonly Style[], options: Options): Promise<BugRun[]> {
  const runs: BugRun[] = []

  for (const { bug, scenario } of TEST_BUGS) {
    for (const style of styles) {
      const title = titleOf(scenario, style)
      const run = await runTests(
        [fileOf(style), "--grep", grepFor(title), "--ci", "--retries", "0"],
        envFor(options, { BENCH_BUGS: bug }),
      )
      const outcome = outcomesOf(run.history).at(0)

      runs.push({ bug, style, scenario, caught: outcome?.status === "failed" })
    }
  }

  return runs
}

/** `danwo matrix` on the checkout test: the correct app, then each provider bug. */
async function matrixRuns(options: Options): Promise<MatrixRunResult[]> {
  const results: MatrixRunResult[] = []

  for (const bug of [null, ...options.matrixBugs]) {
    const run = await runMatrix(
      [
        fileOf(MATRIX_TEST.style),
        "--grep",
        grepFor(titleOf(MATRIX_TEST.scenario, MATRIX_TEST.style)),
        "--workers",
        "4",
      ],
      { BENCH_MODEL: "", BENCH_BUGS: bug ?? "" },
    )
    const failed = [run.history.clean, ...run.history.trials].filter((t) => t.status === "failed")

    results.push({
      bug,
      failed: failed.length,
      lintErrors: run.lintErrors,
      ms: run.history.durationMs,
    })
  }

  return results
}

export async function runBench(options: Options): Promise<BenchResults> {
  const started = Date.now()
  const styles = options.live ? STYLES : (["locators"] as const)
  const runs: StyleRuns[] = []

  for (const style of STYLES) {
    const result = await styleRuns(style, options)

    if (result) runs.push(result)
  }

  const bugs = await bugRuns(styles, options)
  const matrix = await matrixRuns(options)

  return {
    date: new Date().toISOString().slice(0, 10),
    model: options.live ? options.model : "replay",
    live: options.live,
    styles: runs.map((run) => styleMetrics(run, bugs)),
    matrix: matrixMetrics(matrix),
    wallMs: Date.now() - started,
  }
}

/**
 * Gives a live run its AI Gateway key when the environment has none: from the repository's
 * `.env`, or the fidelity key in `.env.fidelity`. Neither file has to exist.
 */
function loadGatewayKey(): void {
  for (const name of [".env", ".env.fidelity"]) {
    const file = join(BENCH_ROOT, "..", name)

    if (existsSync(file)) process.loadEnvFile(file)
  }

  const fidelityKey = process.env["DANWO_FIDELITY_AI_GATEWAY_KEY"]

  if (process.env["AI_GATEWAY_API_KEY"] === undefined && fidelityKey !== undefined)
    process.env["AI_GATEWAY_API_KEY"] = fidelityKey
}

async function main() {
  const options = optionsFrom(process.argv.slice(2))

  if (options.live) loadGatewayKey()

  const results = await runBench(options)
  const name = `${results.date}-${results.model.replaceAll("/", "-")}`
  const text = summary(results)

  await mkdir(options.out, { recursive: true })
  await writeFile(join(options.out, `${name}.json`), `${JSON.stringify(results, null, 2)}\n`)
  await writeFile(join(options.out, `${name}.md`), text)
  process.stdout.write(text)
}

if (import.meta.main) await main()
