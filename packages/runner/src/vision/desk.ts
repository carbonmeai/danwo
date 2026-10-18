/**
 * A session's vision: when it is used, the marks of the latest look the agent's `mark` numbers
 * refer to, the fields secrets went into, and the model that turns "the blue Save button" into a
 * place on a screenshot when the agent named neither a mark nor coordinates.
 */
import { generateText, type LanguageModel } from "ai"
import type { Page } from "playwright-core"
import { z } from "zod"

import type { CallCost } from "../model/resolve.ts"
import { callCost } from "../model/resolve.ts"
import { GROUND_PROMPT } from "./prompts.ts"
import { type Look, look, type Mark, marksText, type SecretSpots } from "./screen.ts"
import type { Point } from "./visual.ts"

/**
 * When the agent may look at the page as an image. `off`: never. `auto` (default): it can ask to,
 * and is told when the page has things the text view misses (a canvas, unnamed buttons, frames
 * whose content is not listed). `always`: it is shown a screenshot with every view.
 */
export type VisionMode = "off" | "auto" | "always"

/** A session's vision setting: a mode, or a mode with a model of its own for images. */
export type VisionSetting =
  | VisionMode
  | {
      readonly mode?: VisionMode
      /** The model that reads screenshots to place a described target; default the agent's model. */
      readonly model?: LanguageModel
    }

/** A call's own choice: `true` is always for this step, `false` off, `"auto"` the default. */
export type VisionChoice = boolean | "auto"

/** The mode a call runs with: its own choice over the session's. */
export function visionFor(session: VisionMode, choice: VisionChoice | undefined): VisionMode {
  if (choice === undefined) return session
  if (choice === true) return "always"

  return choice === false ? "off" : "auto"
}

/** Model ids known to take no images; vision is off for them unless a setting turns it on. */
const TEXT_ONLY = /embed|whisper|tts|o1-mini|o3-mini|-instruct\b/i

/** The id a model is known by, when it has one. */
function modelId(model: LanguageModel | undefined): string | undefined {
  if (model === undefined) return undefined

  return typeof model === "string" ? model : model.modelId
}

/**
 * The mode a setting asks for; without one, `auto` when the model that would read screenshots
 * takes images, as far as its id tells.
 */
export function visionModeOf(
  setting: VisionSetting | undefined,
  model?: LanguageModel,
): VisionMode {
  const own = typeof setting === "string" ? setting : setting?.mode

  if (own !== undefined) return own

  const reader = typeof setting === "object" && setting.model !== undefined ? setting.model : model

  return TEXT_ONLY.test(modelId(reader) ?? "") ? "off" : "auto"
}

/** The model a setting names for reading screenshots, if it names one. */
export function visionModelOf(setting: VisionSetting | undefined): LanguageModel | undefined {
  return typeof setting === "object" ? setting.model : undefined
}

/** Where on a screenshot the agent pointed: a mark, coordinates, or only words. */
export interface Spot {
  readonly mark?: number | undefined
  readonly x?: number | undefined
  readonly y?: number | undefined
  readonly description: string
}

const placed = z.union([
  z.object({ mark: z.number().int().positive() }),
  z.object({ x: z.number(), y: z.number() }),
  z.object({ none: z.string() }),
])

function centre(mark: Mark): Point {
  return { x: mark.box.x + mark.box.width / 2, y: mark.box.y + mark.box.height / 2 }
}

/** The JSON object in a model's answer. */
function jsonIn(text: string): unknown {
  const start = text.indexOf("{")
  const end = text.lastIndexOf("}")

  if (start < 0 || end < start) return undefined

  try {
    return JSON.parse(text.slice(start, end + 1))
  } catch {
    return undefined
  }
}

export interface VisionDeskOptions {
  readonly spots: SecretSpots
  /** The model that places described targets on a screenshot; none means marks or coordinates only. */
  readonly model?: () => Exclude<LanguageModel, string>
  readonly redact: (text: string) => string
  readonly signal?: AbortSignal | undefined
  readonly onModelCall?: (cost: CallCost) => void
}

export class VisionDesk {
  readonly spots: SecretSpots
  private readonly options: VisionDeskOptions
  private latest: Look | undefined

  constructor(options: VisionDeskOptions) {
    this.options = options
    this.spots = options.spots
  }

  /** A fresh look at `page`, whose marks later `mark` numbers refer to. */
  async look(page: Page): Promise<Look> {
    this.latest = await look(page, this.spots)

    return this.latest
  }

  /** The look as words for the model: its size and marks. */
  describe(seen: Look): string {
    const marks = seen.marks.length === 0 ? "no marks" : marksText(seen.marks, this.options.redact)

    return `Screenshot of the viewport, ${seen.width}×${seen.height} CSS pixels; numbered marks over what can be clicked:\n${marks}`
  }

  /** The point the agent means: a mark of the latest look, coordinates, or a described place. */
  async pointFor(page: Page, spot: Spot): Promise<Point> {
    if (spot.mark !== undefined) return this.markPoint(spot.mark)
    if (spot.x !== undefined && spot.y !== undefined) return { x: spot.x, y: spot.y }

    return this.ground(page, spot.description)
  }

  private markPoint(id: number): Point {
    const mark = this.latest?.marks.find((one) => one.id === id)

    if (mark === undefined)
      throw new Error(`there is no mark ${id} in the latest look; call look again`)

    return centre(mark)
  }

  /** Has the vision model place `description` on a fresh look. */
  private async ground(page: Page, description: string): Promise<Point> {
    const model = this.options.model?.()

    if (model === undefined) throw new Error("say where: give a mark from look, or x and y")

    const seen = await this.look(page)
    const result = await generateText({
      model,
      system: GROUND_PROMPT,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: `Find: ${description}\n\n${this.describe(seen)}` },
            { type: "file", data: seen.png, mediaType: "image/png" },
          ],
        },
      ],
      ...(this.options.signal && { abortSignal: this.options.signal }),
    })

    this.options.onModelCall?.(callCost(result.usage, result.providerMetadata))

    return this.placedPoint(placed.safeParse(jsonIn(result.text)).data, description)
  }

  private placedPoint(answer: z.infer<typeof placed> | undefined, description: string): Point {
    if (answer === undefined || "none" in answer)
      throw new Error(`could not find "${description}" on the screen`)

    return "mark" in answer ? this.markPoint(answer.mark) : answer
  }
}
