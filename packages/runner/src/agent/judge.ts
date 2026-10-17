/** `agent.assert`: a judge model reads the page and says whether a claim holds. */
import { generateText, type LanguageModel } from "ai"
import { z } from "zod"

import type { Tabs } from "../browser/tabs.ts"
import { callCost, type CallCost } from "../model/resolve.ts"
import { viewTabs, viewText } from "../snapshot/view.ts"
import { JUDGE_PROMPT } from "./prompts.ts"

const verdictSchema = z.object({ verdict: z.enum(["holds", "fails"]), reason: z.string() })

type Verdict = z.infer<typeof verdictSchema>

/** The claim did not hold, in the judge's words. */
class ClaimFailed extends Error {
  constructor(claim: string, reason: string) {
    super(`agent.assert(${JSON.stringify(claim)}) failed: ${reason}`)
    this.name = "ClaimFailed"
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

export interface JudgeContext {
  readonly model: Exclude<LanguageModel, string>
  readonly tabs: Tabs
  readonly redact: (text: string) => string
  readonly signal?: AbortSignal | undefined
  readonly onModelCall: (cost: CallCost) => void
}

/** Asks the judge about `claim`; resolves when it holds, throws ClaimFailed when not. */
export async function judge(claim: string, context: JudgeContext): Promise<void> {
  const view = await viewTabs(context.tabs, context.redact)
  const result = await generateText({
    model: context.model,
    system: JUDGE_PROMPT,
    prompt: `Claim: ${claim}\n\nThe page now:\n${viewText(view)}`,
    ...(context.signal && { abortSignal: context.signal }),
  })

  context.onModelCall(callCost(result.usage, result.providerMetadata))

  const verdict = parseVerdict(result.text)

  if (verdict === undefined) throw new ClaimFailed(claim, "the judge gave no verdict")
  if (verdict.verdict === "fails") throw new ClaimFailed(claim, context.redact(verdict.reason))
}
