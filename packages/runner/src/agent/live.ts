/**
 * A step run by the model on a browser page: it is shown the instruction, the params and the page
 * as an accessibility tree, and carries the instruction out one tool call at a time (the turns
 * themselves are loop.ts's). Dialogs the page opens are held for the agent to answer.
 */
import type { LanguageModel, ModelMessage, UserContent } from "ai"

import type { Tabs } from "../browser/tabs.ts"
import type { MailDesk } from "../mail/desk.ts"
import type { CallCost } from "../model/resolve.ts"
import { type Params, shownParams } from "../replay/params.ts"
import type { SecretVault } from "../secrets/index.ts"
import { type PageView, viewTabs, viewText } from "../snapshot/view.ts"
import type { VisionDesk } from "../vision/desk.ts"
import { VISION_GUIDE } from "../vision/prompts.ts"
import { gapsLine, hasGaps, visualGaps } from "../vision/screen.ts"
import type { Spends } from "./budget.ts"
import type { Files } from "./files.ts"
import { type LoopResult, type Outcome as BaseOutcome, ToolLoop } from "./loop.ts"
import { type Call, parseCall, perform } from "./perform.ts"
import { ACTOR_PROMPT } from "./prompts.ts"
import { toolsFor } from "./tools.ts"

/** No single action on an element waits longer than this, whatever the session's timeout. */
const ACTION_CAP_MS = 15_000

export interface LiveContext {
  readonly model: Exclude<LanguageModel, string>
  readonly tabs: Tabs
  readonly appUrl: string
  readonly vault: SecretVault
  readonly params: Params
  /** Files the step may upload, by name. */
  readonly files: Files
  readonly timeout: number
  readonly context?: string | undefined
  readonly signal?: AbortSignal | undefined
  /** What the step and its test may still spend. */
  readonly spends: Spends
  /** The conversation's size budget in characters before older views are dropped. */
  readonly transcriptBudget?: number | undefined
  /** Waits, after an action, for the page and the backend to go quiet (see readiness.ts). */
  readonly ready: () => Promise<void>
  /** How the app failed since the step began, if it did; the step stops at once. */
  readonly appFailure?: () => Error | undefined
  /** Mail the app sent, as the emulators caught it. */
  readonly mail: MailDesk
  /**
   * The step's vision when it may look at the page as an image: `auto` offers the tools and says
   * when the text view misses something, `always` also shows a screenshot with every view.
   */
  readonly vision?: { readonly mode: "auto" | "always"; readonly desk: VisionDesk } | undefined
  /** Moves time forward, when the step may travel in time. */
  readonly travel?: ((ms: number) => Promise<void>) | undefined
  /** Called for every model call and every action, for the step's record. */
  readonly onModelCall: (cost: CallCost) => void
  readonly onAction: (label: string) => void
}

export type LiveResult = LoopResult

function firstLines(
  instruction: string,
  live: Pick<LiveContext, "params" | "files" | "context">,
): string {
  const lines = [`Instruction: ${instruction}`]
  const shown = shownParams(live.params)
  const files = Object.keys(live.files)
  const context = live.context

  if (Object.keys(shown).length > 0) lines.push(`Params: ${JSON.stringify(shown)}`)
  if (files.length > 0) lines.push(`Files you may upload: ${files.join(", ")}`)
  if (context !== undefined) lines.push(`About this app: ${context}`)

  return lines.join("\n")
}

/** What carrying out an action came to, with a screenshot it took for the model. */
interface Outcome extends BaseOutcome {
  /** A screenshot the action produced for the model. */
  readonly image?: { readonly png: Buffer; readonly text: string }
}

/** A user message showing a screenshot, with what it shows in words. */
function imageMessage(image: { readonly png: Buffer; readonly text: string }): ModelMessage {
  const content: UserContent = [
    { type: "text", text: image.text },
    { type: "file", data: image.png, mediaType: "image/png" },
  ]

  return { role: "user", content }
}

class Loop extends ToolLoop<PageView, Call, Outcome> {
  private readonly live: LiveContext

  constructor(live: LiveContext) {
    super({ ...live, redact: live.vault.redact })
    this.live = live
  }

  run(instruction: string): Promise<LiveResult> {
    return this.live.tabs.holdingDialogs(() => this.turns(instruction))
  }

  protected opening(instruction: string): string {
    return firstLines(instruction, this.live)
  }

  /** The view as the model reads it; with vision on, a note of what the text leaves out. */
  protected async viewFor(view: PageView): Promise<string> {
    const text = viewText(view)

    if (this.live.vision === undefined || this.live.tabs.dialog !== undefined) return text

    const gaps = await visualGaps(this.live.tabs.page, view.tree)

    return hasGaps(gaps) ? `${text}\n\n${gapsLine(gaps)}` : text
  }

  /**
   * Shows the screenshots the turn's actions took; with vision always on, a fresh look at the page
   * when no action took one.
   */
  protected async showScreen(_view: PageView, outcomes: readonly Outcome[]): Promise<void> {
    const images = outcomes.flatMap((outcome) =>
      outcome.image === undefined ? [] : [outcome.image],
    )
    const vision = this.live.vision

    if (images.length === 0 && vision?.mode === "always" && this.live.tabs.dialog === undefined) {
      const seen = await vision.desk.look(this.live.tabs.page)

      images.push({ png: seen.png, text: vision.desk.describe(seen) })
    }

    for (const image of images) this.transcript.push(imageMessage(image))
  }

  protected look() {
    return viewTabs(this.live.tabs, this.live.vault.redact)
  }

  protected system(): string {
    return this.live.vision === undefined ? ACTOR_PROMPT : `${ACTOR_PROMPT}\n${VISION_GUIDE}`
  }

  protected tools() {
    return toolsFor(this.live.vision !== undefined, this.live.travel !== undefined)
  }

  protected parse(name: string, input: unknown) {
    return parseCall(name, input)
  }

  protected label(call: Call): string {
    return `${call.name} ${this.live.vault.redact(JSON.stringify(call.input))}`
  }

  protected async perform(call: Call, view: PageView) {
    const performed = await perform(call, {
      ...this.live,
      timeout: Math.min(this.live.timeout, ACTION_CAP_MS),
      tree: view.tree,
      vision: this.live.vision?.desk,
    })

    return {
      outcome: performed.outcome,
      recorded: performed.recorded,
      ...(performed.image !== undefined && { image: performed.image }),
    }
  }
}

/** Runs `instruction` with the model until it calls `done`. */
export function runLive(instruction: string, context: LiveContext): Promise<LiveResult> {
  return new Loop(context).run(instruction)
}
