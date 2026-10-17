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
import { generateText, type LanguageModel, type UserContent } from "ai"
import { z } from "zod"

import type { Tabs } from "../browser/tabs.ts"
import { callCost, type CallCost } from "../model/resolve.ts"
import { viewTabs, viewText } from "../snapshot/view.ts"
import { JUDGE_PROMPT } from "./prompts.ts"

const verdictSchema = z.object({
  verdict: z.enum(["holds", "fails", "blocked", "inconclusive"]),
  reason: z.string(),
})

type Verdict = z.infer<typeof verdictSchema>

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
class ClaimFailed extends Error {
  readonly code: (typeof CODES)[keyof typeof CODES]

  constructor(claim: string, verdict: Exclude<Verdict["verdict"], "holds">, reason: string) {
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
        { type: "image", image: input.screen.screenshot, mediaType: "image/png" },
      ]
}

/** How the judge is called: its model, cancellation, and where its cost goes. */
export interface JudgeCall {
  readonly model: Exclude<LanguageModel, string>
  readonly signal?: AbortSignal | undefined
  readonly onModelCall: (cost: CallCost) => void
}

/** Asks the judge about `input`; the verdict, or undefined when it gave none. */
async function askJudge(input: JudgeInput, call: JudgeCall): Promise<Verdict | undefined> {
  const result = await generateText({
    model: call.model,
    system: JUDGE_PROMPT,
    messages: [{ role: "user", content: judgeMessage(input) }],
    ...(call.signal && { abortSignal: call.signal }),
  })

  call.onModelCall(callCost(result.usage, result.providerMetadata))

  return parseVerdict(result.text)
}

export interface JudgeContext extends JudgeCall {
  readonly tabs: Tabs
  readonly redact: (text: string) => string
  /** Trusted words about the app, passed to the judge as its vocabulary. */
  readonly vocabulary?: string | undefined
  /** Show the judge a screenshot of the page as well. */
  readonly screenshot?: boolean
}

/** The judge's input for `claim` on the page the session shows now. */
async function inputFor(claim: string, context: JudgeContext): Promise<JudgeInput> {
  const view = await viewTabs(context.tabs, context.redact)
  const screenshot = context.screenshot
    ? await context.tabs.page.screenshot({ type: "png" }).catch(() => undefined)
    : undefined

  return {
    claim,
    screen: { text: viewText(view), ...(screenshot && { screenshot }) },
    ...(context.vocabulary !== undefined && { vocabulary: context.vocabulary }),
  }
}

/** Asks the judge about `claim`; resolves when it holds, throws ClaimFailed otherwise. */
export async function judge(claim: string, context: JudgeContext): Promise<void> {
  const verdict = await askJudge(await inputFor(claim, context), context)

  if (verdict === undefined)
    throw new ClaimFailed(claim, "inconclusive", "the judge gave no verdict")
  if (verdict.verdict !== "holds")
    throw new ClaimFailed(claim, verdict.verdict, context.redact(verdict.reason))
}
