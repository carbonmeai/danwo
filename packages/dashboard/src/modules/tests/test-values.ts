/** How the tests pages word what they show: what the matrix made of a test, and what a filter reads. */
import type { MatrixVerdict, TestRow } from "./tests-data.ts"

/** What the latest matrix run made of a test, in a few words. */
export function matrixWords(verdict: MatrixVerdict): string {
  if (verdict.kind === "none") return "no matrix yet"
  if (verdict.kind === "clean-failed") return "clean run failed"
  if (verdict.kind === "held") return `held ${verdict.judged}/${verdict.judged}`

  const [first, ...more] = verdict.broke

  return `breaks under: ${first ?? ""}${more.length > 0 ? ` +${more.length} more` : ""}`
}

/** The words the filter box matches a test against. */
export function testText(row: TestRow): string {
  return [row.id, row.file ?? "", row.last?.status ?? "never run", matrixWords(row.matrix)].join(
    " ",
  )
}
