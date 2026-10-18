/**
 * The agent's actions on the page as an image: looking, and clicking, typing, dragging and
 * scrolling at a place on the latest screenshot. Each place is recorded by how it looks (see
 * vision/visual.ts) before acting, so the recording shows the page as the agent saw it.
 */
import type { Tabs } from "../browser/tabs.ts"
import type { RecordedAction, RecordedInput } from "../replay/trace.ts"
import type { SecretVault } from "../secrets/index.ts"
import type { Spot, VisionDesk } from "../vision/desk.ts"
import { dragBetween, scrollOver } from "../vision/pointer.ts"
import { captureVisual, type Point, type VisualTarget } from "../vision/visual.ts"
import { type Aftermath, watched } from "./operate.ts"
import type { ToolInput } from "./tools.ts"

/** What a vision action needs of the step. */
export interface VisionPerformContext {
  readonly tabs: Tabs
  readonly vision: VisionDesk | undefined
  readonly vault: SecretVault
  readonly timeout: number
  readonly ready: () => Promise<void>
  /** How typed text is recorded: from mail, a param, or as written. */
  readonly typed: (text: string) => RecordedInput
  /** The handle of a secret by name: the step's param of that name, else the session's secret. */
  readonly secret: (name: string) => ReturnType<SecretVault["handle"]>
}

/** What a vision action came to: what the model is told, the recording, and any screenshot. */
export interface VisionPerformed {
  readonly outcome: string
  readonly recorded: RecordedAction | undefined
  /** A screenshot for the model, with what it shows in words. */
  readonly image?: { readonly png: Buffer; readonly text: string }
}

function deskOf(context: VisionPerformContext): VisionDesk {
  if (context.vision === undefined)
    throw new Error("this step does not use vision; use the refs of the text view")

  return context.vision
}

function afterText(after: Aftermath): string {
  if (after.dialog !== undefined)
    return `done; a ${after.dialog.type} dialog opened: ${JSON.stringify(after.dialog.message)}. Answer it with the dialog tool.`

  return after.openedTab ? "done; a new tab opened and is now the active one" : "done"
}

/** The point the agent means, recorded before anything changes. */
async function aim(
  context: VisionPerformContext,
  spot: Spot,
): Promise<{ point: Point; visual: VisualTarget }> {
  const desk = deskOf(context)
  const page = context.tabs.page
  const point = await desk.pointFor(page, spot)

  return { point, visual: await captureVisual(page, point, spot.description, desk.spots) }
}

export async function lookNow(context: VisionPerformContext): Promise<VisionPerformed> {
  const desk = deskOf(context)
  const seen = await desk.look(context.tabs.page)
  const text = desk.describe(seen)

  return {
    outcome: `the screenshot follows. ${text}`,
    recorded: undefined,
    image: { png: seen.png, text },
  }
}

export async function clickAt(
  context: VisionPerformContext,
  input: ToolInput<"click_at">,
): Promise<VisionPerformed> {
  const { point, visual } = await aim(context, input)
  const after = await watched(context.tabs, () => context.tabs.page.mouse.click(point.x, point.y), {
    timeout: context.timeout,
    mayOpenTab: true,
  })

  if (after.dialog === undefined) await context.ready()

  return {
    outcome: afterText(after),
    recorded: { kind: "click_at", visual, ...(after.openedTab && { opensTab: true }) },
  }
}

/** What `type_at` types, and how it is recorded. */
async function typedOf(
  context: VisionPerformContext,
  input: ToolInput<"type_at">,
): Promise<{ value: string; recorded: RecordedInput }> {
  if (input.secret !== undefined) {
    const secret = context.secret(input.secret)

    return { value: await context.vault.reveal(secret), recorded: { secret: secret.name } }
  }

  if (input.text === undefined) throw new Error("type_at needs `text` or `secret`")

  return { value: input.text, recorded: context.typed(input.text) }
}

export async function typeAt(
  context: VisionPerformContext,
  input: ToolInput<"type_at">,
): Promise<VisionPerformed> {
  const typed = await typedOf(context, input)
  const { point, visual } = await aim(context, input)
  const page = context.tabs.page

  /* A secret typed here is painted over in every later screenshot and patch. */
  if (input.secret !== undefined && visual.anchor !== undefined)
    deskOf(context).spots.add(page.locator(visual.anchor.css))
  await page.mouse.click(point.x, point.y)
  await page.keyboard.type(typed.value)
  await context.ready()

  return { outcome: "done", recorded: { kind: "type_at", visual, input: typed.recorded } }
}

export async function dragAt(
  context: VisionPerformContext,
  input: ToolInput<"drag_at">,
): Promise<VisionPerformed> {
  const from = await aim(context, input.from)
  const to = await aim(context, input.to)

  await dragBetween(context.tabs.page.mouse, from.point, to.point)
  await context.ready()

  return { outcome: "done", recorded: { kind: "drag_at", visual: from.visual, to: to.visual } }
}

export async function scrollAt(
  context: VisionPerformContext,
  input: ToolInput<"scroll_at">,
): Promise<VisionPerformed> {
  const { point, visual } = await aim(context, input)

  await scrollOver(context.tabs.page.mouse, point, input.direction)
  await context.ready()

  return { outcome: "done", recorded: { kind: "scroll_at", visual, direction: input.direction } }
}
