/**
 * `agent.waitFor` and `agent.assert` steps: a condition or a claim in plain words, which the judge
 * decides. The first time, the judge looks at the page (every so often, for a wait) until it says
 * the condition holds, and names a short text on the page that shows it. That text is the
 * recording: a replay waits for it to appear and asks no model. When it does not appear, the page
 * changed: the judge is asked afresh, and the step is handed off. Under strict replay there is no
 * model: evidence that does not appear in time is a divergence, and a step with no recording fails.
 */
import type { Tabs } from "../browser/tabs.ts"
import type { CacheNote, CacheOutcome } from "../record/steps.ts"
import { embedsValue, type Params } from "../replay/params.ts"
import type { ReplayStore, StepKey } from "../replay/store.ts"
import type { WaitTrace } from "../replay/trace.ts"
import { DanwoError } from "../support/codes.ts"
import { ReplayMissing } from "./errors.ts"
import { type JudgeContext, judgeUntil, type Poll, type Unheld } from "./judge.ts"
import { missError, missOf, missWhy } from "./miss.ts"

export interface WaitStepContext {
  readonly tabs: Tabs
  readonly store: ReplayStore | undefined
  readonly strict: boolean
  /** Replay only and call no judge: a step with no recorded evidence that shows fails. */
  readonly replayOnly?: boolean
  /** How the judge keeps asking; undefined asks it once. */
  readonly poll: Poll | undefined
  /** How long a replay waits for the recorded evidence to be shown. */
  readonly within: number
  /** The judge, set up for the step; throws when the session has no model. */
  readonly judge: () => JudgeContext
  /** The error a verdict other than `holds` ends the step with, given the judge's reason. */
  readonly fail: (verdict: Unheld, reason: string) => Error
  readonly redact: (text: string) => string
  /** Values a recording must not contain (read from emulators, for instance). */
  readonly volatile: () => readonly string[]
  readonly cache: (outcome: CacheOutcome, detail?: Omit<CacheNote, "mode">) => void
  /** Ends the session's replay here; later steps do nothing. */
  readonly diverge: (reason: string) => string
}

/** One judged step: which kind, its place in the journey, and what it says. */
export interface JudgedStep {
  readonly kind: "wait" | "assert"
  readonly index: number
  readonly condition: string
  readonly params: Params
}

export interface WaitResult {
  /** True when the recorded evidence appeared and no model was asked. */
  readonly replayed: boolean
}

/** Waits up to `timeout` for `text` to be shown on the active tab; false when it never was. */
async function shown(tabs: Tabs, text: string, timeout: number): Promise<boolean> {
  return tabs.page
    .getByText(text)
    .first()
    .waitFor({ state: "visible", timeout })
    .then(() => true)
    .catch(() => false)
}

/** Whether `evidence` can be a recording: it is on the page, and holds no value that varies. */
function usable(
  evidence: string | undefined,
  page: string,
  params: Params,
  volatile: readonly string[],
): evidence is string {
  return (
    evidence !== undefined &&
    evidence.trim().length > 0 &&
    page.includes(evidence) &&
    !embedsValue(evidence, params, volatile)
  )
}

/** The error a wait that never saw its condition ends with. */
export function notHeld(condition: string, verdict: Unheld, reason: string, timeout: number) {
  const code = verdict === "blocked" ? "CLAIM_BLOCKED" : "WAIT_TIMED_OUT"

  return new DanwoError(
    code,
    `agent.waitFor(${JSON.stringify(condition)}) did not hold within ${timeout} ms: ${reason}`,
  )
}

async function fromRecording(
  key: StepKey | undefined,
  context: WaitStepContext,
): Promise<
  | { readonly replayed: true; readonly recordedBy: string | undefined }
  | { readonly reason: string | undefined }
> {
  const trace = key === undefined ? undefined : await context.store?.readWait(key.key)

  if (trace === undefined) return { reason: undefined }
  if (await shown(context.tabs, trace.evidence.text, context.within))
    return { replayed: true, recordedBy: trace.recordedBy }

  return {
    reason: context.redact(`"${trace.evidence.text}" was not shown within ${context.within} ms`),
  }
}

/** Runs one waitFor or assert step. */
export async function waitStep(step: JudgedStep, context: WaitStepContext): Promise<WaitResult> {
  const { condition, params } = step
  const { store } = context
  const { kind, index } = step
  const key = store?.key({ kind, step: index, instruction: condition, params })
  const recorded = await fromRecording(key, context)

  if ("replayed" in recorded) {
    context.cache("replayed", store?.crossModel(recorded, kind))

    return { replayed: true }
  }

  const miss: CacheNote =
    recorded.reason === undefined
      ? await missOf(store, key)
      : { mode: "handed-off", reason: recorded.reason }

  if (context.replayOnly === true) {
    const api = kind === "assert" ? "agent.assert" : "agent.waitFor"

    context.cache(recorded.reason === undefined ? miss.mode : "diverged", {
      ...(recorded.reason !== undefined && { reason: recorded.reason }),
    })
    throw new ReplayMissing(api, context.redact(condition), missWhy(miss))
  }

  if (context.strict) {
    if (recorded.reason === undefined) {
      context.cache(miss.mode, miss)
      throw missError(step.index, condition, miss)
    }

    context.cache("diverged", { reason: recorded.reason })
    context.diverge(recorded.reason)

    return { replayed: false }
  }

  const { verdict, page } = await judgeUntil(condition, context.judge(), context.poll)

  if (verdict.verdict !== "holds") {
    context.cache(miss.mode, miss)
    throw context.fail(verdict.verdict, context.redact(verdict.reason))
  }

  const saved = await keep(key, step, verdict.evidence, page, context)

  context.cache(miss.mode, { ...miss, saved })

  return { replayed: false }
}

/** Writes the judge's evidence as the step's recording when it can be one. */
async function keep(
  key: StepKey | undefined,
  step: JudgedStep,
  evidence: string | undefined,
  page: string,
  context: WaitStepContext,
): Promise<boolean> {
  const { store } = context

  if (key === undefined || store === undefined || !store.writes) return false
  if (!usable(evidence, page, step.params, context.volatile())) return false

  const trace: WaitTrace = {
    version: 1,
    kind: step.kind,
    instruction: step.condition,
    recordedAt: new Date().toISOString(),
    evidence: { text: evidence },
  }

  await store.writeExtract(key, trace)

  return true
}
