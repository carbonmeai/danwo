/**
 * `agent.assert`: a judge model reads the page and says whether a claim holds. The judge is kept
 * apart from the actor: it is given the claim, the page as it is now (and a screenshot when the
 * session asks for one) and the app's vocabulary, nothing else. No transcript, no earlier steps,
 * no instruction it could take the actor's word from. `JudgeInput` is the whole of what reaches it.
 *
 * Four verdicts: `holds`; `fails`; `blocked` when the page is not where the claim could be judged
 * (an error page, a login wall, still loading); `inconclusive` when the page does not show enough
 * to tell either way.
 */
import { generateText, type LanguageModel, type ModelMessage, type UserContent } from "ai"
import { z } from "zod"

import type { Tabs } from "../browser/tabs.ts"
import { throwIfRefused } from "../model/refusal.ts"
import { callCost, type CallCost } from "../model/resolve.ts"
import { viewLimit } from "../snapshot/limit.ts"
import { type ViewCut, viewTabs, viewText } from "../snapshot/view.ts"
import { DanwoError } from "../support/codes.ts"
import { hasGaps, screenshot as shoot, SecretSpots, visualGaps } from "../vision/screen.ts"
import { JUDGE_PROMPT } from "./prompts.ts"

const verdictSchema = z.object({
  verdict: z.enum(["holds", "fails", "blocked", "inconclusive"]),
  reason: z.string(),
  /** For a wait or claim that holds: text on the page whose presence shows it (see WAIT_PROMPT). */
  evidence: z.string().optional(),
})

export type Verdict = z.infer<typeof verdictSchema>

/** A verdict that did not let the step pass. */
export type Unheld = Exclude<Verdict["verdict"], "holds">

/** Everything the judge sees. */
export interface JudgeInput {
  readonly claim: string
  /** The page now: its accessibility tree as text, and a PNG when the session takes one. */
  readonly screen: { readonly text: string; readonly screenshot?: Uint8Array }
  /** Trusted words about the app, from the project. */
  readonly vocabulary?: string
}

const CODES = {
  fails: "CLAIM_FAILED",
  blocked: "CLAIM_BLOCKED",
  inconclusive: "CLAIM_INCONCLUSIVE",
} as const

/** The claim did not hold, could not be judged, or could not be decided, in the judge's words. */
export class ClaimFailed extends Error {
  readonly code: (typeof CODES)[keyof typeof CODES]

  constructor(claim: string, verdict: Unheld, reason: string) {
    const word = verdict === "fails" ? "failed" : verdict

    super(`agent.assert(${JSON.stringify(claim)}) ${word}: ${reason}`)
    this.name = "ClaimFailed"
    this.code = CODES[verdict]
  }
}

/** The JSON object in a model's answer, tolerating a code fence or words around it. */
function parseVerdict(text: string): Verdict | undefined {
  const start = text.indexOf("{")
  const end = text.lastIndexOf("}")

  if (start < 0 || end < start) return undefined

  try {
    const parsed = verdictSchema.safeParse(JSON.parse(text.slice(start, end + 1)))

    return parsed.success ? parsed.data : undefined
  } catch {
    return undefined
  }
}

/** The judge's message, built from its input alone. */
export function judgeMessage(input: JudgeInput): UserContent {
  const about = input.vocabulary === undefined ? "" : `About this app: ${input.vocabulary}\n\n`
  const text = `${about}Claim: ${input.claim}\n\nThe page now:\n${input.screen.text}`

  return input.screen.screenshot === undefined
    ? [{ type: "text", text }]
    : [
        { type: "text", text },
        { type: "file", data: input.screen.screenshot, mediaType: "image/png" },
      ]
}

/** How the judge is called: its model, cancellation, and where its cost goes. */
export interface JudgeCall {
  readonly model: Exclude<LanguageModel, string>
  readonly signal?: AbortSignal | undefined
  readonly onModelCall: (cost: CallCost) => void
  /** What the judge is told about its job; default the claim checker's. */
  readonly system?: string
}

/** Times the judge is asked again after an answer that held no verdict. */
const VERDICT_RETRIES = 2

const NO_VERDICT =
  'Your answer held no verdict. Answer with only a JSON object: {"verdict": "holds" | "fails" | "blocked" | "inconclusive", "reason": "..."}.'

/**
 * Asks the judge about `input`. An answer with no usable verdict is sent back with what was wrong,
 * up to `VERDICT_RETRIES` times; after that the step is `MODEL_OUTPUT_INVALID`, which says
 * nothing about the app. A refusal is `MODEL_REFUSED` at once.
 */
async function askJudge(input: JudgeInput, call: JudgeCall): Promise<Verdict> {
  const messages: ModelMessage[] = [{ role: "user", content: judgeMessage(input) }]

  for (let attempt = 0; ; attempt++) {
    const result = await generateText({
      model: call.model,
      system: call.system ?? JUDGE_PROMPT,
      messages,
      ...(call.signal && { abortSignal: call.signal }),
    })
    const cost = callCost(result.usage, result.providerMetadata)

    call.onModelCall(attempt > 0 ? { ...cost, retry: true } : cost)
    throwIfRefused(result, `to judge the claim ${JSON.stringify(input.claim)}`, call.model)

    const verdict = parseVerdict(result.text)

    if (verdict !== undefined) return verdict
    if (attempt >= VERDICT_RETRIES)
      throw new DanwoError(
        "MODEL_OUTPUT_INVALID",
        `the judge gave no usable verdict in ${attempt + 1} answers`,
      )

    messages.push(...result.response.messages, { role: "user", content: NO_VERDICT })
  }
}

export interface JudgeContext extends JudgeCall {
  readonly tabs: Tabs
  readonly redact: (text: string) => string
  /** Trusted words about the app, passed to the judge as its vocabulary. */
  readonly vocabulary?: string | undefined
  /**
   * Show the judge a screenshot of the page as well: always, or `"auto"` when the page has parts
   * the text view misses (a canvas, unnamed buttons, unlisted frames).
   */
  readonly screenshot?: boolean | "auto"
  /** Fields secrets went into, painted over in the screenshot. */
  readonly spots?: SecretSpots
  /** Told each time the judge's view of the page was cut to fit its model. */
  readonly onViewCut?: (cut: ViewCut) => void
}

/** Whether the judge gets a screenshot of the page `tree` describes. */
async function wantsScreenshot(context: JudgeContext, tree: string): Promise<boolean> {
  if (context.screenshot !== "auto") return context.screenshot === true

  return hasGaps(await visualGaps(context.tabs.page, tree))
}

/** The judge's input for `claim` on the page the session shows now. */
async function inputFor(claim: string, context: JudgeContext): Promise<JudgeInput> {
  const view = await viewTabs(context.tabs, context.redact, viewLimit(context.model))

  if (view.cut !== undefined) context.onViewCut?.(view.cut)
  const screenshot = (await wantsScreenshot(context, view.tree))
    ? await shoot(context.tabs.page, context.spots ?? new SecretSpots()).catch(() => undefined)
    : undefined

  return {
    claim,
    screen: { text: viewText(view), ...(screenshot && { screenshot }) },
    ...(context.vocabulary !== undefined && { vocabulary: context.vocabulary }),
  }
}

/** The judge's verdict on `claim` for the page as it is now, with the page text it was shown. */
async function judgeNow(
  claim: string,
  context: JudgeContext,
): Promise<{ readonly verdict: Verdict; readonly page: string }> {
  const input = await inputFor(claim, context)

  return { verdict: await askJudge(input, context), page: input.screen.text }
}

/** How long to keep asking, and how often: `poll: true` is the session's assertion timeout. */
export interface Poll {
  readonly timeout: number
  readonly interval: number
}

function sleep(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms)

    signal?.addEventListener("abort", () => {
      clearTimeout(timer)
      resolve()
    })
  })
}

/**
 * Asks the judge about `claim` until it holds or `poll` runs out; the last verdict, and the page
 * it was given on. Without `poll` it asks once.
 */
export function judgeUntil(
  claim: string,
  context: JudgeContext,
  poll: Poll | undefined,
): Promise<{ readonly verdict: Verdict; readonly page: string }> {
  return untilHolds(() => judgeNow(claim, context), poll, context.signal)
}

/** Asks `judged` again until its verdict holds or `poll` runs out; once without `poll`. */
async function untilHolds(
  judged: () => Promise<{ readonly verdict: Verdict; readonly page: string }>,
  poll: Poll | undefined,
  signal: AbortSignal | undefined,
): Promise<{ readonly verdict: Verdict; readonly page: string }> {
  const deadline = performance.now() + (poll?.timeout ?? 0)

  for (;;) {
    const answer = await judged()
    const left = deadline - performance.now()

    if (answer.verdict.verdict === "holds" || poll === undefined || left <= 0) return answer

    await sleep(Math.min(poll.interval, left), signal)
  }
}

/** A judge of a screen that is not a page, such as a device's: it is shown what `see` gives. */
export interface ScreenJudge extends JudgeCall {
  readonly redact: (text: string) => string
  readonly vocabulary?: string | undefined
  /** The screen now, as the judge reads it. */
  readonly see: () => Promise<JudgeInput["screen"]>
}

/** The verdict on `claim` for the screen `context` sees, asked until it holds or `poll` ends. */
export function judgeScreenUntil(
  claim: string,
  context: ScreenJudge,
  poll: Poll | undefined,
): Promise<{ readonly verdict: Verdict; readonly page: string }> {
  return untilHolds(
    async () => {
      const screen = await context.see()
      const input = {
        claim,
        screen,
        ...(context.vocabulary !== undefined && { vocabulary: context.vocabulary }),
      }

      return { verdict: await askJudge(input, context), page: screen.text }
    },
    poll,
    context.signal,
  )
}

/** Asks the judge about `claim` on the screen; resolves when it holds, throws otherwise. */
export async function judgeScreen(claim: string, context: ScreenJudge, poll?: Poll): Promise<void> {
  const { verdict } = await judgeScreenUntil(claim, context, poll)

  if (verdict.verdict !== "holds")
    throw new ClaimFailed(claim, verdict.verdict, context.redact(verdict.reason))
}
