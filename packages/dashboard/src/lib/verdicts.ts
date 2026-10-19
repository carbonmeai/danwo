/** The verdict colours every status reads in, and how each status is written. */

/** The five verdict colours. */
export type Tone = "passed" | "failed" | "flaky" | "notJudged" | "invalid"

/** One count in a verdict strip. */
export interface Share {
  readonly tone: Tone
  readonly count: number
  readonly label: string
}

/** Which colour each status reads in, so a failure looks the same on every page. */
const TONES: Readonly<Record<string, Tone>> = {
  passed: "passed",
  matched: "passed",
  replayed: "passed",
  holds: "passed",
  failed: "failed",
  fails: "failed",
  diverged: "failed",
  "timed-out": "failed",
  interrupted: "failed",
  "environment-error": "failed",
  flaky: "flaky",
  relocated: "flaky",
  "handed-off": "flaky",
  stale: "flaky",
  partial: "flaky",
  "not-judged": "notJudged",
  blocked: "notJudged",
  inconclusive: "notJudged",
  invalid: "invalid",
  missed: "invalid",
  skipped: "invalid",
}

/** A status's colour; unknown statuses read neutral. */
export function toneOf(status: string): Tone {
  return TONES[status] ?? "invalid"
}

/** How each status is written: words, not codes. */
const WORDS: Readonly<Record<string, string>> = {
  "not-judged": "not judged",
  "timed-out": "timed out",
  "environment-error": "environment error",
  "handed-off": "handed off",
}

export function wordOf(status: string): string {
  return WORDS[status] ?? status
}
