import type { Tabs } from "../browser/tabs.ts"
/**
 * One `agent.waitFor` step: wait until a condition in plain words holds. The first time, the
 * judge looks at the page every so often until it says the condition holds, and names a short
 * text on the page that shows it. That text is the recording: a replay waits for it to appear and
 * asks no model. Under strict replay there is no model: evidence that does not appear in time is a
 * divergence, and a step with no recording fails.
 */
import type { CacheNote, CacheOutcome } from "../record/steps.ts"
import { embedsValue, type Params } from "../replay/params.ts"
import type { ReplayStore, StepKey } from "../replay/store.ts"
import type { WaitTrace } from "../replay/trace.ts"
import { DanwoError } from "../support/codes.ts"
import { type JudgeContext, judgeUntil, type Poll, type Verdict } from "./judge.ts"
import { missError, missOf } from "./miss.ts"

export interface WaitStepContext {
  readonly tabs: Tabs
  readonly store: ReplayStore | undefined
  readonly strict: boolean
  readonly poll: Poll
  /** The judge, set up to watch for a condition; throws when the session has no model. */
  readonly judge: () => JudgeContext
  readonly redact: (text: string) => string
  /** Values a recording must not contain (read from emulators, for instance). */
  readonly volatile: () => readonly string[]
  readonly cache: (outcome: CacheOutcome, detail?: Omit<CacheNote, "mode">) => void
  /** Ends the session's replay here; later steps do nothing. */
  readonly diverge: (reason: string) => string
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
function notHeld(condition: string, verdict: Verdict, timeout: number): DanwoError {
  const code = verdict.verdict === "blocked" ? "CLAIM_BLOCKED" : "WAIT_TIMED_OUT"

  return new DanwoError(
    code,
    `agent.waitFor(${JSON.stringify(condition)}) did not hold within ${timeout} ms: ${verdict.reason}`,
  )
}

async function fromRecording(
  key: StepKey | undefined,
  context: WaitStepContext,
): Promise<{ readonly replayed: true } | { readonly reason: string | undefined }> {
  const trace = key === undefined ? undefined : await context.store?.readWait(key.key)

  if (trace === undefined) return { reason: undefined }
  if (await shown(context.tabs, trace.evidence.text, context.poll.timeout))
    return { replayed: true }

  return {
    reason: context.redact(
      `"${trace.evidence.text}" was not shown within ${context.poll.timeout} ms`,
    ),
  }
}

/** Runs one waitFor step. */
export async function waitStep(
  step: { readonly index: number; readonly condition: string; readonly params: Params },
  context: WaitStepContext,
): Promise<WaitResult> {
  const { condition, params } = step
  const { store } = context
  const key = store?.key({ kind: "wait", step: step.index, instruction: condition, params })
  const recorded = await fromRecording(key, context)

  if ("replayed" in recorded) {
    context.cache("replayed")

    return { replayed: true }
  }

  const miss: CacheNote =
    recorded.reason === undefined ? await missOf(store, key) : { mode: "handed-off" }

  if (context.strict) {
    if (recorded.reason === undefined) {
      context.cache(miss.mode, miss)
      throw missError(step.index, condition, miss)
    }

    context.cache("diverged")
    context.diverge(recorded.reason)

    return { replayed: false }
  }

  const { verdict, page } = await judgeUntil(condition, context.judge(), context.poll)

  if (verdict.verdict !== "holds") throw notHeld(condition, verdict, context.poll.timeout)

  const saved = await keep(key, condition, verdict.evidence, page, params, context)

  context.cache(miss.mode, { ...miss, saved })

  return { replayed: false }
}

/** Writes the judge's evidence as the step's recording when it can be one. */
async function keep(
  key: StepKey | undefined,
  condition: string,
  evidence: string | undefined,
  page: string,
  params: Params,
  context: WaitStepContext,
): Promise<boolean> {
  const { store } = context

  if (key === undefined || store === undefined || !store.writes) return false
  if (!usable(evidence, page, params, context.volatile())) return false

  const trace: WaitTrace = {
    version: 1,
    kind: "wait",
    instruction: condition,
    recordedAt: new Date().toISOString(),
    evidence: { text: evidence },
  }

  await store.writeExtract(key, trace)

  return true
}
