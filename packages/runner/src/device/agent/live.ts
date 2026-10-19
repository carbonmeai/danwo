/**
 * A step run by the model on a device: it is shown the instruction, the params and the screen in
 * the page view's format, and carries the instruction out one tool call at a time (the turns
 * themselves are the web agent's loop). With vision on it may look at the screen as an image.
 */
import type { LanguageModel, ModelMessage, UserContent } from "ai"

import type { Spends } from "../../agent/budget.ts"
import { type LoopResult, type Outcome, ToolLoop } from "../../agent/loop.ts"
import type { MailDesk } from "../../mail/desk.ts"
import type { CallCost } from "../../model/resolve.ts"
import { type Params, shownParams } from "../../replay/params.ts"
import type { SecretVault } from "../../secrets/index.ts"
import type { ActContext } from "./act.ts"
import { type DeviceEyes, type Look, marksText, unnamed } from "./eyes.ts"
import { performOnDevice } from "./perform.ts"
import { DEVICE_ACTOR_PROMPT, DEVICE_VISION_GUIDE } from "./prompts.ts"
import { type DeviceCall, deviceToolsFor, parseDeviceCall } from "./tools.ts"
import { type DeviceView, deviceView, deviceViewText } from "./view.ts"

/** No single action waits longer than this, whatever the session's timeout. */
const ACTION_CAP_MS = 15_000

export interface DeviceLiveContext extends ActContext {
  readonly model: Exclude<LanguageModel, string>
  readonly vault: SecretVault
  readonly params: Params
  readonly mail: MailDesk
  readonly context?: string | undefined
  readonly signal?: AbortSignal | undefined
  readonly spends: Spends
  readonly transcriptBudget?: number | undefined
  /** The step's eyes and how it may use them: `auto` offers them, `always` shows every screen. */
  readonly vision?: { readonly mode: "auto" | "always"; readonly eyes: DeviceEyes } | undefined
  readonly onModelCall: (cost: CallCost) => void
  readonly onAction: (label: string) => void
}

/** What a device call came to, with a look it took for the model. */
interface DeviceOutcome extends Outcome {
  readonly look?: Look
}

/** A user message showing a screenshot, with its marks in words. */
function imageMessage(look: Look, redact: (text: string) => string): ModelMessage {
  const content: UserContent = [
    { type: "text", text: marksText(look, redact) },
    { type: "file", data: look.png, mediaType: "image/png" },
  ]

  return { role: "user", content }
}

class DeviceLoop extends ToolLoop<DeviceView, DeviceCall, DeviceOutcome> {
  private readonly live: DeviceLiveContext
  private lastLook: Look | undefined

  constructor(live: DeviceLiveContext) {
    super({ ...live, redact: live.vault.redact })
    this.live = live
  }

  run(instruction: string): Promise<LoopResult> {
    return this.turns(instruction)
  }

  protected async look(): Promise<DeviceView> {
    const { target, vault } = this.live

    return deviceView(await target.read(), await target.foreground(), vault.redact)
  }

  /** The view as the model reads it; with vision on, a note of what the text leaves out. */
  protected viewFor(view: DeviceView): string {
    const text = deviceViewText(view)
    const missing = this.live.vision === undefined ? 0 : unnamed(view.nodes)

    return missing === 0
      ? text
      : `${text}\n\n${missing} control(s) on the screen have no name in this view; look shows them.`
  }

  protected opening(instruction: string): string {
    const lines = [`Instruction: ${instruction}`]
    const shown = shownParams(this.live.params)

    if (Object.keys(shown).length > 0) lines.push(`Params: ${JSON.stringify(shown)}`)
    if (this.live.context !== undefined) lines.push(`About this app: ${this.live.context}`)

    return lines.join("\n")
  }

  /** The looks the turn took; with vision always on, a fresh one when the turn took none. */
  protected async showScreen(view: DeviceView, outcomes: readonly DeviceOutcome[]): Promise<void> {
    const vision = this.live.vision
    const looks = outcomes.flatMap((outcome) => (outcome.look === undefined ? [] : [outcome.look]))

    if (looks.length === 0 && vision?.mode === "always") {
      const look = await vision.eyes.look(view.nodes)

      if (look !== undefined) looks.push(look)
    }

    for (const look of looks) {
      this.lastLook = look
      this.transcript.push(imageMessage(look, this.live.vault.redact))
    }
  }

  protected system(): string {
    return this.live.vision === undefined
      ? DEVICE_ACTOR_PROMPT
      : `${DEVICE_ACTOR_PROMPT}\n${DEVICE_VISION_GUIDE}`
  }

  protected tools() {
    return deviceToolsFor(this.live.vision !== undefined)
  }

  protected parse(name: string, input: unknown) {
    return parseDeviceCall(name, input)
  }

  protected label(call: DeviceCall): string {
    return `${call.name} ${this.live.vault.redact(JSON.stringify(call.input))}`
  }

  protected async perform(call: DeviceCall, view: DeviceView) {
    const performed = await performOnDevice(call, {
      ...this.live,
      timeout: Math.min(this.live.timeout, ACTION_CAP_MS),
      view,
      eyes: this.live.vision?.eyes,
      look: this.lastLook,
    })

    return {
      outcome: performed.outcome,
      recorded: performed.recorded,
      ...(performed.look !== undefined && { look: performed.look }),
    }
  }
}

/** Runs `instruction` on the device with the model until it calls `done`. */
export function runOnDevice(instruction: string, context: DeviceLiveContext): Promise<LoopResult> {
  return new DeviceLoop(context).run(instruction)
}
