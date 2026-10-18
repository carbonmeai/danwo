/** The benchmark's results as a markdown summary: one row per style, then the matrix. */
import type { MatrixMetrics, StyleMetrics } from "./metrics.ts"

export interface BenchResults {
  readonly date: string
  readonly model: string
  readonly live: boolean
  readonly styles: readonly StyleMetrics[]
  readonly matrix: MatrixMetrics
  readonly wallMs: number
}

const pct = (value: number) => `${Math.round(value * 100)}%`

const usd = (value: number) => `$${value.toFixed(4)}`

function styleRow(style: StyleMetrics): string {
  const replay = style.replay ? `${style.replay.calls} (${style.replay.passed} passed)` : "–"

  return [
    style.style,
    `${pct(style.passRate)} (${style.passed}/${style.scenarios - style.skipped})`,
    String(style.skipped),
    String(style.falseFailures),
    style.bugsRun === 0 ? "–" : `${pct(style.catchRate)} (${style.bugsCaught}/${style.bugsRun})`,
    String(style.firstRun.calls),
    usd(style.firstRun.usd),
    `${style.firstRun.msPerTest} ms`,
    replay,
  ].join(" | ")
}

export function summary(results: BenchResults): string {
  const header =
    "| Style | Pass rate | Not expressible | False failures | Bugs caught | Model calls | Cost | Time / test | Replay calls |"
  const rule = "|---|---|---|---|---|---|---|---|---|"
  const rows = results.styles.map((style) => `| ${styleRow(style)} |`)
  const matrix = results.matrix.byBug.map(
    (entry) => `| ${entry.bug} | ${entry.caught ? "caught" : "missed"} | ${entry.how} |`,
  )

  return [
    `## danwo benchmark · ${results.date} · ${results.model}${results.live ? "" : " (not live)"}`,
    "",
    header,
    rule,
    ...rows,
    "",
    `### danwo matrix on provider bugs: ${pct(results.matrix.catchRate)} caught (${results.matrix.caught}/${results.matrix.bugs}), ${results.matrix.falseFailures} false failures on the correct app`,
    "",
    "| Bug | Result | How |",
    "|---|---|---|",
    ...matrix,
    "",
    `Wall time: ${Math.round(results.wallMs / 1000)} s`,
    "",
  ].join("\n")
}
