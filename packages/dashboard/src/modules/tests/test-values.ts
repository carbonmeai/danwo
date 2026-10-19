/**
 * How the tests pages word and sort what they show: which filter tab a test falls under, what the
 * matrix made of it in a few words, and what a recording was a recording of.
 */
import { toneOf } from "../../lib/verdicts.ts"
import type { RecordingChoice, TestRunEntry } from "./test-data.ts"
import type { MatrixVerdict, TestRow } from "./tests-data.ts"

/** The tabs over the tests list. */
export const TEST_FILTERS = ["all", "failing", "flaky", "breaks"] as const

export type TestFilter = (typeof TEST_FILTERS)[number]

export const FILTER_WORDS: Readonly<Record<TestFilter, string>> = {
  all: "All",
  failing: "Failing",
  flaky: "Flaky",
  breaks: "Breaks under faults",
}

export function isTestFilter(value: unknown): value is TestFilter {
  return typeof value === "string" && (TEST_FILTERS as readonly string[]).includes(value)
}

/** Which tests each tab holds. */
const UNDER: Readonly<Record<TestFilter, (row: TestRow) => boolean>> = {
  all: () => true,
  failing: (row) => row.last !== undefined && toneOf(row.last.status) === "failed",
  flaky: (row) => (row.flakeRate ?? 0) > 0 || row.last?.status === "flaky",
  breaks: (row) => row.matrix.kind === "broke" || row.matrix.kind === "clean-failed",
}

/** Whether the test belongs under the tab. */
export function inFilter(row: TestRow, filter: TestFilter): boolean {
  return UNDER[filter](row)
}

/** The words the filter box matches a test against. */
export function testText(row: TestRow): string {
  return [row.id, row.file ?? "", row.last?.status ?? "never run", matrixWords(row.matrix)].join(
    " ",
  )
}

/** What the latest matrix run made of a test, in a few words. */
export function matrixWords(verdict: MatrixVerdict): string {
  if (verdict.kind === "none") return "no matrix yet"
  if (verdict.kind === "clean-failed") return "clean run failed"
  if (verdict.kind === "held") return `held ${verdict.judged}/${verdict.judged}`

  const [first, ...more] = verdict.broke

  return `breaks under: ${first ?? ""}${more.length > 0 ? ` +${more.length} more` : ""}`
}

/** What a recording was a recording of, as the player's picker lists it. */
export function choiceLabel(choice: RecordingChoice): string {
  if (choice.kind === "matrix")
    return choice.fault ? `Matrix: ${choice.fault}` : "Matrix: clean run"

  return choice.attempt === undefined ? "Test run" : `Test run, try ${choice.attempt}`
}

/** A run of the test, in a line: how it went and what it ran. */
export function entryLine(entry: TestRunEntry): string {
  if (entry.kind === "matrix")
    return entry.faults === 0
      ? "Matrix: no faults ran"
      : entry.broke === 0
        ? `Matrix: held under all ${entry.faults} faults`
        : `Matrix: broke under ${entry.broke} of ${entry.faults} faults`

  return entry.retries === 0
    ? "Test run"
    : `Test run, ${entry.retries} ${entry.retries === 1 ? "retry" : "retries"}`
}

/** The tabs under the player on a test's page. */
export const TEST_TABS = ["steps", "calls", "matrix", "history", "state", "console"] as const

export type TestTab = (typeof TEST_TABS)[number]

export const TAB_WORDS: Readonly<Record<TestTab, string>> = {
  steps: "Steps",
  calls: "Calls and webhooks",
  matrix: "Matrix",
  history: "History",
  state: "Emulator state",
  console: "Console",
}

export function isTestTab(value: unknown): value is TestTab {
  return typeof value === "string" && (TEST_TABS as readonly string[]).includes(value)
}
