/**
 * Whose failure a failed attempt is: the app's, the test's, the environment's, danwo's own, or not
 * yet decidable. The class of an error code says how a failure counts; the verdict says who should
 * act on it, read from the evidence the run left: the app's answers and page errors, where a crash
 * was thrown, and the fault a matrix trial injected.
 */
import { fileURLToPath } from "node:url"

import { routeOf } from "@danwo/matrix"

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
  readonly startedAt?: string
  readonly durationMs?: number | null
  /** Who sent it: a page (`browser`) or a server, such as the app's own backend. */
  readonly client?: "browser" | "server"
}

/** A step of the attempt as the verdict reads it. */
export interface VerdictStep {
  readonly index: number
  readonly kind: string
  readonly api: string
  readonly status: string
  readonly startedAt: string
  readonly durationMs: number
  /** The call as written; for an agent step, its instruction. */
  readonly label?: string
  /** For an agent step: whether it replayed its recording or the model carried it out. */
  readonly cache?: { readonly mode: string }
}

/** A line the app's page logged, as the verdict reads it. */
export interface VerdictLog {
  readonly level: string
  readonly source: string
  readonly text: string
  /** The step that was running when it was logged. */
  readonly step?: number
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
  /** The attempt's steps, which place the failure in time. */
  readonly steps?: readonly VerdictStep[]
  /** Routes that answered 5xx in attempts that passed: noise the app makes either way. */
  readonly baseline?: ReadonlySet<string>
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

/**
 * A 5xx the app answered on its own: no fault put it there, no route or block answered it, and
 * it is no page load.
 */
function isServerError(call: VerdictCall): boolean {
  return (
    call.asset !== true &&
    call.fault === null &&
    call.disposition !== "routed" &&
    call.disposition !== "blocked" &&
    call.status !== null &&
    call.status >= 500
  )
}

/** The routes of the app's own 5xx answers among `calls`, for the baseline passing attempts keep. */
export function serverErrorRoutes(calls: readonly VerdictCall[]): string[] {
  return calls.filter(isServerError).map(routeOf)
}

/** When a call or step started, in ms; undefined when it carries no time. */
function startOf(item: { readonly startedAt?: string }): number | undefined {
  const at = item.startedAt === undefined ? NaN : Date.parse(item.startedAt)

  return Number.isNaN(at) ? undefined : at
}

/**
 * Whether `call` failed only on a refusal: a server's call to a blocked or unrouted host went out
 * while the app answered it, so its 5xx says the run cut the app off, not that the app broke.
 */
function proxiesBlocked(call: VerdictCall, calls: readonly VerdictCall[]): boolean {
  const from = startOf(call)

  if (from === undefined) return false

  const to = from + (call.durationMs ?? 0)

  return calls.some((other) => {
    const at = startOf(other)

    return (
      other.disposition === "blocked" &&
      other.client !== "browser" &&
      at !== undefined &&
      at >= from &&
      at <= to
    )
  })
}

/** Whether a step checks what came before it: an assertion, a value check, a judged claim. */
function verifies(step: VerdictStep): boolean {
  return step.kind === "assertion" || step.kind === "check" || step.api === "agent.assert"
}

/**
 * Where the failure is read: from the first step after the last check that held to the end of
 * the step that failed, in time and by step index.
 */
interface StepWindow {
  readonly from: number
  readonly to: number
  readonly first: number
  readonly last: number
}

/** The failing work's window; undefined when no step failed, so the whole attempt counts. */
function stepWindow(steps: readonly VerdictStep[]): StepWindow | undefined {
  const failing = steps.findLastIndex(
    (step) => step.status !== "passed" && step.status !== "running",
  )
  const failed = steps[failing]

  if (failed === undefined) return undefined

  const held = steps
    .slice(0, failing)
    .findLastIndex((step) => step.status === "passed" && verifies(step))
  const first = steps[held + 1] ?? failed

  return {
    from: startOf(first) ?? -Infinity,
    to: (startOf(failed) ?? Infinity) + failed.durationMs,
    first: first.index,
    last: failed.index,
  }
}

/** Whether a call started inside the window; one with no time, or with no window, is inside. */
function inWindow(call: VerdictCall, window: StepWindow | undefined): boolean {
  const at = startOf(call)

  return window === undefined || at === undefined || (at >= window.from && at <= window.to)
}

/** Whether a call started before the failing step ended. */
function beforeEnd(call: VerdictCall, window: StepWindow | undefined): boolean {
  const at = startOf(call)

  return window === undefined || at === undefined || at <= window.to
}

function isWrite(call: VerdictCall): boolean {
  return call.method !== "GET" && call.method !== "HEAD"
}

/** The app's 5xx that best explains the failure, and where it fell. */
interface AppFailure {
  readonly call: VerdictCall
  readonly inWindow: boolean
}

/**
 * The 5xx that matters. A route that also failed in passing attempts, and a call that failed only
 * on a refused call of its own, are left out. Of the rest, a write while the failing work ran
 * wins, then any call then, then a write before it, then any call before it; the one closest to
 * the failing step first.
 */
function appFailure(
  evidence: VerdictEvidence,
  window: StepWindow | undefined,
): AppFailure | undefined {
  const { calls, baseline } = evidence
  const before = calls.filter(
    (call) =>
      isServerError(call) &&
      baseline?.has(routeOf(call)) !== true &&
      !proxiesBlocked(call, calls) &&
      beforeEnd(call, window),
  )
  const during = before.filter((call) => inWindow(call, window))
  const call =
    during.filter(isWrite).at(-1) ?? during.at(-1) ?? before.filter(isWrite).at(-1) ?? before.at(-1)

  return call === undefined ? undefined : { call, inWindow: inWindow(call, window) }
}

/** An uncaught error the page threw before the failing step ended, one thrown during it first. */
function pageError(
  appLog: readonly VerdictLog[],
  window: StepWindow | undefined,
): { readonly line: VerdictLog; readonly inWindow: boolean } | undefined {
  const at = (line: VerdictLog) => line.step ?? window?.last ?? 0
  const thrown = appLog.filter(
    (line) => line.source === "page-error" && (window === undefined || at(line) <= window.last),
  )
  const during = thrown.filter((line) => window === undefined || at(line) >= window.first)
  const line = during.at(-1) ?? thrown.at(-1)

  return line === undefined ? undefined : { line, inWindow: during.includes(line) }
}

/** Cache outcomes of an `agent.act` step that replayed its recording rather than ask the model. */
const REPLAYED = new Set(["replayed", "relocated", "diverged"])

/**
 * The last `agent.act` step before the failure that the model carried out: what it did is only
 * as good as the model's word for it, so a check failing after it may be the step's fault.
 */
function modelAct(steps: readonly VerdictStep[]): VerdictStep | undefined {
  const failing = steps.findLastIndex(
    (step) => step.status !== "passed" && step.status !== "running",
  )
  const before = failing === -1 ? steps : steps.slice(0, failing)

  return before.findLast(
    (step) =>
      step.api === "agent.act" && step.status === "passed" && !REPLAYED.has(step.cache?.mode ?? ""),
  )
}

/** The first line of a message, trimmed for a reason. */
function brief(text: string): string {
  const first = (text.split("\n")[0] ?? "").trim()

  return first.length > 120 ? `${first.slice(0, 117)}…` : first
}

/** The app's own misbehaviour, as a reason, with how sure it makes the verdict. */
interface AppEvidence {
  readonly reason: string
  readonly confidence: VerdictConfidence
  /** Whether it happened while the failing work ran. */
  readonly inWindow: boolean
}

/**
 * The app's own misbehaviour in the evidence; undefined when it behaved. Only an app that stopped,
 * or a 5xx on a write while the failing work ran, is certain.
 */
function appEvidence(evidence: VerdictEvidence): AppEvidence | undefined {
  const down = evidence.appsDown?.[0]

  if (down !== undefined)
    return {
      reason: `the app ${down} stopped during the test`,
      confidence: "certain",
      inWindow: true,
    }

  const window = stepWindow(evidence.steps ?? [])
  const failed = appFailure(evidence, window)

  if (failed !== undefined) {
    const { call } = failed

    return {
      reason: `the app answered ${call.method} ${call.host}${call.path.split("?")[0] ?? ""} with ${call.status}`,
      confidence: failed.inWindow && isWrite(call) ? "certain" : "likely",
      inWindow: failed.inWindow,
    }
  }

  const thrown = pageError(evidence.appLog, window)

  if (thrown === undefined) return undefined

  return {
    reason: `the page threw an uncaught error: ${brief(thrown.line.text)}`,
    confidence: "likely",
    inWindow: thrown.inWindow,
  }
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

/** A failure with no app errors behind it that its code alone points at. */
function quietVerdict(error: TestError): FailureVerdict | undefined {
  if (LOCATOR_CODES.has(error.code))
    return judged(
      "test",
      "likely",
      `${error.code} on a page that loaded with no app errors: the locator may be stale`,
    )
  if (error.code === "SESSION_SETUP_FAILED")
    return judged("test", "likely", "the saved session's setup failed on a page with no app errors")
  if (AGENT_CODES.has(error.code))
    return judged(
      "test",
      "likely",
      `${error.code} with no app errors: the step may need a clearer instruction or a bigger budget`,
    )
  if (error.code === "TIMED_OUT")
    return judged("undecided", "likely", "the test ran past its deadline with no app errors")

  return undefined
}

/** A failure the app's behaviour has to decide. */
function weighedVerdict(evidence: VerdictEvidence, error: TestError): FailureVerdict {
  const app = appEvidence(evidence)

  if (error.code === "CLAIM_FAILED" && app?.inWindow !== true)
    return judged("undecided", "likely", "the judge says the claim doesn't hold")
  if (app !== undefined) return judged("app", app.confidence, `${app.reason}, then ${error.code}`)

  const quiet = quietVerdict(error)

  if (quiet !== undefined) return quiet

  const act = modelAct(evidence.steps ?? [])

  if (act !== undefined)
    return judged(
      "undecided",
      "likely",
      `${error.code} with no app errors after the model carried out ${act.label === undefined ? `step ${act.index}` : JSON.stringify(act.label)}: it may not have done what the step asked; the record's calls show what it did`,
    )

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
 * uncaught page error, an app that stopped) make it the app's. A judged claim that failed with no
 * app error while its work ran is undecided; without app errors a missing element is likely the
 * test's, a failed check after an `agent.act` step the model carried out is undecided (the model
 * may only have claimed the step done), and any other failed check is likely the app's.
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
