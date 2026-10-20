/**
 * Whose failure a failed attempt is: the app's, the test's, the environment's, danwo's own, or not
 * yet decidable. The class of an error code says how a failure counts; the verdict says who should
 * act on it, read from the evidence the run left: the app's answers and page errors, where a crash
 * was thrown, and the fault a matrix trial injected.
 */
import { fileURLToPath } from "node:url"

import type { ErrorCode } from "../support/codes.ts"
import type { TestError } from "../support/errors.ts"
import type { FailureVerdict, Verdict, VerdictConfidence } from "./verdict-words.ts"

/** A call through the proxy as the verdict reads it. */
export interface VerdictCall {
  readonly method: string
  readonly host: string
  readonly path: string
  readonly status: number | null
  readonly fault: string | null
  readonly disposition?: "routed" | "passthrough" | "blocked"
  readonly asset?: boolean
}

/** A line the app's page logged, as the verdict reads it. */
export interface VerdictLog {
  readonly level: string
  readonly source: string
  readonly text: string
}

/** What a failed attempt left behind that the verdict weighs. */
export interface VerdictEvidence {
  readonly error: TestError | undefined
  /** A matrix trial's fault label; absent for a test attempt, null for a matrix's clean run. */
  readonly fault?: string | null
  readonly calls: readonly VerdictCall[]
  readonly appLog: readonly VerdictLog[]
  /** Apps of the environment that stopped during the attempt. */
  readonly appsDown?: readonly string[]
}

/** Codes that mean the run never really got to test the app. */
const ENVIRONMENT_CODES: ReadonlySet<ErrorCode> = new Set([
  "ENVIRONMENT_FAILED",
  "BROWSER_FAILED",
  "MODEL_UNAVAILABLE",
])

/** Codes for a test that could not work as written, whatever the app did. */
const TEST_CODES: ReadonlySet<ErrorCode> = new Set(["CONFIG_INVALID", "SECRET_REFUSED"])

/** Codes for an agent step that could not be carried out on the page it found. */
const AGENT_CODES: ReadonlySet<ErrorCode> = new Set([
  "AGENT_STEP_FAILED",
  "AGENT_LOOPING",
  "BUDGET_EXCEEDED",
  "EXTRACT_FAILED",
])

/** Codes for a locator that found no element, or too many. */
const LOCATOR_CODES: ReadonlySet<ErrorCode> = new Set(["LOCATOR_NOT_FOUND", "LOCATOR_AMBIGUOUS"])

/** JavaScript's own crash errors: a bug in whatever code threw them. */
const CRASHES = new Set(["TypeError", "ReferenceError", "RangeError", "SyntaxError"])

/** danwo's own source folders, and its packages once installed. */
const DANWO_ROOT = fileURLToPath(new URL("../../../", import.meta.url))
const INSTALLED = /[\\/]node_modules[\\/]@danwo[\\/]/

/** A stack frame's file, from `at fn (file:line:col)` or `at file:line:col`. */
const FRAME = /^\s*at (?:.*? \()?(?:file:\/\/)?([^\s()]+?):\d+:\d+\)?\s*$/

/** The files of a stack's frames, top first, leaving out Node's own. */
export function stackFiles(stack: string | undefined): string[] {
  return (stack ?? "")
    .split("\n")
    .map((line) => FRAME.exec(line)?.[1])
    .filter((file): file is string => file !== undefined && !file.startsWith("node:"))
}

/** Whether `file` is danwo's own code rather than the project's. */
function isDanwo(file: string): boolean {
  return (
    INSTALLED.test(file) ||
    (file.startsWith(DANWO_ROOT) &&
      !file.includes("?danwo-realm=") &&
      !/[\\/](test|tests|examples)[\\/]/.test(file.slice(DANWO_ROOT.length)))
  )
}

/** An app call that failed on its own: a 5xx no fault put there, page loads left out. */
function appFailure(calls: readonly VerdictCall[]): VerdictCall | undefined {
  return calls.find(
    (call) =>
      call.asset !== true &&
      call.fault === null &&
      call.disposition !== "routed" &&
      call.status !== null &&
      call.status >= 500,
  )
}

/** An uncaught error the page threw. */
function pageError(appLog: readonly VerdictLog[]): VerdictLog | undefined {
  return appLog.find((line) => line.source === "page-error")
}

/** The first line of a message, trimmed for a reason. */
function brief(text: string): string {
  const first = (text.split("\n")[0] ?? "").trim()

  return first.length > 120 ? `${first.slice(0, 117)}…` : first
}

/** The app's own misbehaviour in the evidence, as a reason; undefined when it behaved. */
function appEvidence(evidence: VerdictEvidence): string | undefined {
  const down = evidence.appsDown?.[0]

  if (down !== undefined) return `the app ${down} stopped during the test`

  const call = appFailure(evidence.calls)

  if (call !== undefined)
    return `the app answered ${call.method} ${call.host}${call.path.split("?")[0] ?? ""} with ${call.status}`

  const thrown = pageError(evidence.appLog)

  if (thrown !== undefined) return `the page threw an uncaught error: ${brief(thrown.text)}`

  return undefined
}

function judged(verdict: Verdict, confidence: VerdictConfidence, reason: string): FailureVerdict {
  return { verdict, confidence, reason }
}

/** A test's own crash: in danwo's code, or in the test's. */
function crashVerdict(error: TestError): FailureVerdict {
  const files = stackFiles(error.stack)
  const top = files[0]

  if (top !== undefined && isDanwo(top) && CRASHES.has(error.name))
    return judged(
      "danwo",
      "likely",
      `${error.name} thrown inside danwo (${top.slice(DANWO_ROOT.length) || top}); please report it to danwo with the flight record`,
    )

  const where = error.source ? ` at ${error.source.file}:${error.source.line}` : ""

  return judged(
    "test",
    error.source || (top !== undefined && !isDanwo(top)) ? "certain" : "likely",
    `the test's own code threw ${error.name}${where}: ${brief(error.message)}`,
  )
}

/** A failure the class of its code settles before any evidence is read. */
function settledByCode(error: TestError): FailureVerdict | undefined {
  if (error.class === "interrupted") return judged("undecided", "certain", "the run was stopped")
  if (ENVIRONMENT_CODES.has(error.code))
    return judged("environment", "certain", `${error.code}: ${brief(error.message)}`)
  if (TEST_CODES.has(error.code))
    return judged("test", "certain", `${error.code}: ${brief(error.message)}`)
  if (error.class === "blocked" || error.class === "inconclusive")
    return judged("undecided", "certain", `${error.code}: ${brief(error.message)}`)
  if (error.code === "APP_ERROR" || error.code === "PROVIDER_ERROR")
    return judged("app", "certain", brief(error.message))

  return undefined
}

/** A failure the app's behaviour has to decide. */
function weighedVerdict(evidence: VerdictEvidence, error: TestError): FailureVerdict {
  const app = appEvidence(evidence)

  if (app !== undefined) return judged("app", "certain", `${app}, then ${error.code}`)
  if (LOCATOR_CODES.has(error.code))
    return judged(
      "test",
      "likely",
      `${error.code} on a page that loaded with no app errors: the locator may be stale`,
    )
  if (error.code === "SESSION_SETUP_FAILED")
    return judged(
      "test",
      "likely",
      `the saved session's setup failed with no app errors: ${brief(error.message)}`,
    )
  if (AGENT_CODES.has(error.code))
    return judged(
      "test",
      "likely",
      `${error.code} with no app errors: the step may need a clearer instruction or a bigger budget`,
    )
  if (error.code === "TIMED_OUT")
    return judged("undecided", "likely", "the test ran past its deadline with no app errors")

  return judged(
    "app",
    "likely",
    `${error.code} with the app answering without errors: the app showed something the test did not expect`,
  )
}

/**
 * Whose failure `evidence` is. Rules, in order: a matrix trial whose check broke under its fault
 * is the app's; the code's class settles environment, config and undecided failures; a crash is
 * danwo's when thrown inside danwo, else the test's; then the app's own errors (a 5xx, an
 * uncaught page error, an app that stopped) make it the app's, and without them a missing
 * element is likely the test's while a failed check is likely the app's.
 */
export function failureVerdict(evidence: VerdictEvidence): FailureVerdict {
  const { error } = evidence

  if (error === undefined)
    return judged("undecided", "likely", "the attempt failed without an error")

  const settled = settledByCode(error)

  if (settled !== undefined) return settled
  if (typeof evidence.fault === "string" && error.class === "test" && error.code !== "TEST_FAILED")
    return judged("app", "certain", `the check broke under the fault ${evidence.fault}`)
  if (error.code === "TEST_FAILED") return crashVerdict(error)

  return weighedVerdict(evidence, error)
}

/**
 * A matrix trial's verdict from its outcome alone: a trial that failed under its fault broke the
 * app's check; one the environment failed never tested it; one not judged or not fired says
 * nothing yet. A failing clean run is left to its flight record, which weighs the evidence.
 */
export function trialVerdict(
  status: TrialStatus,
  fault: string | null,
  error: string | null,
): FailureVerdict | undefined {
  const why = error === null ? "" : `: ${brief(error)}`
  const byStatus: Readonly<Record<TrialStatus, FailureVerdict | undefined>> = {
    passed: undefined,
    failed:
      fault === null
        ? judged("undecided", "likely", `the clean run failed${why}; its record says why`)
        : judged("app", "certain", `the check broke under the fault ${fault}`),
    "environment-error": judged("environment", "certain", `the environment failed${why}`),
    invalid: judged("undecided", "certain", "the fault never fired, so the trial says nothing"),
    "not-judged": judged("undecided", "certain", `the trial could not be judged${why}`),
  }

  return byStatus[status]
}

/** A matrix trial's outcome, as `trialVerdict` reads it. */
export type TrialStatus = "passed" | "failed" | "invalid" | "not-judged" | "environment-error"
