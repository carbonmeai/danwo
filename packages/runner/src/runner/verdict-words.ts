/**
 * How verdicts are worded: their labels, their counts in a summary line, and what each asks a
 * coding agent to fix. Free of Node so the dashboard's pages can word them the same way.
 */

/** Who a failure belongs to. */
export type Verdict = "app" | "test" | "environment" | "danwo" | "undecided"

/** How sure the verdict is: `certain` when the evidence names the cause, `likely` when it points. */
export type VerdictConfidence = "certain" | "likely"

export interface FailureVerdict {
  readonly verdict: Verdict
  readonly confidence: VerdictConfidence
  /** One sentence naming the evidence the verdict rests on. */
  readonly reason: string
}

/** The label each verdict shows under. */
export const VERDICT_LABELS: Readonly<Record<Verdict, string>> = {
  app: "App bug",
  test: "Test issue",
  environment: "Environment",
  danwo: "danwo bug",
  undecided: "Undecided",
}

/** The verdicts, in the order summaries list them. */
const VERDICT_ORDER: readonly Verdict[] = ["app", "test", "environment", "danwo", "undecided"]

/** Failed attempts counted by verdict, in the labels' order, leaving out those with none. */
export function verdictCounts(
  verdicts: readonly (FailureVerdict | undefined)[],
): { verdict: Verdict; count: number }[] {
  return VERDICT_ORDER.map((key) => ({
    verdict: key,
    count: verdicts.filter((v) => v?.verdict === key).length,
  })).filter(({ count }) => count > 0)
}

/** "3 app bugs · 2 test issues · 1 environment", for summary lines. */
export function verdictSummary(verdicts: readonly (FailureVerdict | undefined)[]): string {
  return verdictCounts(verdicts)
    .map(({ verdict: key, count }) => `${count} ${pluralLabel(key, count)}`)
    .join(" · ")
}

function pluralLabel(key: Verdict, count: number): string {
  const label = VERDICT_LABELS[key]
  const lower = key === "danwo" ? label : label.toLowerCase()

  if (count === 1 || key === "environment" || key === "undecided") return lower

  return `${lower}s`
}

/** What a coding agent reading each verdict's failure should fix. */
const ADVICE: Readonly<Record<Verdict, string>> = {
  app: "Fix the app: the test caught the product misbehaving. Change the test only if the behaviour it checks was meant to change.",
  test: "Fix the test: it broke or went stale while the app behaved. Leave the app alone unless the record shows otherwise.",
  environment:
    "Fix the setup: the run never got to test the app (environment, browser, model or keys).",
  danwo:
    "This looks like a bug in danwo itself: please report it to danwo with the flight record, and change neither the app nor the test for it.",
  undecided:
    "Neither the app nor the test is clearly at fault yet: read the record before changing either.",
}

/** What to fix, for a coding agent reading the failure: the app, the test, or neither. */
export function fixAdvice(found: FailureVerdict): string {
  return ADVICE[found.verdict]
}
