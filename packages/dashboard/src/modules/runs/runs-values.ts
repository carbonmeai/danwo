/** How the runs list words and sorts a run: its one-word verdict, its counts and its filter text. */
import type { Share } from "../../lib/verdicts.ts"
import type { RunRow } from "./runs-data.ts"

/** Runs per page of the list. */
export const PAGE_SIZE = 50

/** The one word a run's result reads as: its worst verdict. */
export function verdictOf(row: RunRow): string {
  const { counts } = row

  if (counts.failed > 0) return "failed"
  if (counts.flaky > 0) return "flaky"
  if (counts.passed > 0) return "passed"
  if (counts.notJudged > 0) return "not-judged"

  return counts.invalid > 0 ? "invalid" : "skipped"
}

export function sharesOf(row: RunRow): Share[] {
  return [
    { tone: "passed", count: row.counts.passed, label: "passed" },
    { tone: "flaky", count: row.counts.flaky, label: "flaky" },
    { tone: "failed", count: row.counts.failed, label: "failed" },
    { tone: "notJudged", count: row.counts.notJudged, label: "not judged" },
    {
      tone: "invalid",
      count: row.counts.invalid + row.counts.skipped,
      label: "invalid or skipped",
    },
  ]
}

/** The result in words, such as "12 passed, 3 failed: 2 app bugs · 1 test issue". */
export function countLine(row: RunRow): string {
  return sharesOf(row)
    .filter((share) => share.count > 0)
    .map((share) =>
      share.tone === "failed" && row.whose !== ""
        ? `${share.count} ${share.label}: ${row.whose}`
        : `${share.count} ${share.label}`,
    )
    .join(", ")
}

/** What the filter searches in a row: its title, command and verdicts. */
export function runText(row: RunRow): string {
  return `${row.title} danwo ${row.kind} ${countLine(row)} ${verdictOf(row)}`
}

export function median(values: readonly number[]): number {
  const sorted = values.toSorted((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)

  return sorted.length % 2 === 1
    ? (sorted[mid] ?? 0)
    : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2
}
