/**
 * Replaying actions taken on a screenshot: each place is found again by how it looks (see
 * vision/visual.ts) before acting. A replay that may look for moved targets also searches for a
 * place that is no longer where it was, and the recording is updated to where it was found; one
 * that may not (strict replay) stops when the picture at the recorded place has changed.
 */
import { type Aftermath, watched } from "../agent/operate.ts"
import type { Tabs } from "../browser/tabs.ts"
import { dragBetween, scrollOver } from "../vision/pointer.ts"
import { SecretSpots } from "../vision/screen.ts"
import { findVisual, movedTo, type Point, type VisualTarget } from "../vision/visual.ts"
import type { RecordedAction, RecordedInput } from "./trace.ts"

/** What replaying a vision action needs of the replay. */
export interface VisionReplayContext {
  readonly tabs: Tabs
  readonly timeout: number
  /** Whether a place that moved may be searched for. */
  readonly relocate: boolean
  readonly spots: SecretSpots | undefined
  /** The text a recorded input stands for in this run. */
  readonly text: (input: RecordedInput) => Promise<string>
}

/** What one replayed vision action did. */
interface VisionReplayed {
  readonly label: string
  readonly after?: Aftermath
  readonly revised?: RecordedAction
  readonly movedPlaces: readonly { readonly from: string; readonly to: string }[]
}

type ActionOf<Kind extends RecordedAction["kind"]> = Extract<RecordedAction, { kind: Kind }>

function at(point: Point): string {
  return `${Math.round(point.x)},${Math.round(point.y)}`
}

/** A recorded place found on the screen now, and the place as the recording should keep it. */
interface Placed {
  readonly point: Point
  readonly visual: VisualTarget
  readonly moved?: { readonly from: string; readonly to: string }
}

async function place(context: VisionReplayContext, visual: VisualTarget): Promise<Placed> {
  const page = context.tabs.page
  const found = await findVisual(page, visual, {
    spots: context.spots ?? new SecretSpots(),
    relocate: context.relocate,
    timeout: context.timeout,
  })

  if (!found.moved) return { point: found.point, visual }

  return {
    point: found.point,
    visual: await movedTo(page, visual, found.point),
    moved: { from: `"${visual.description}" at ${at(visual.point)}`, to: at(found.point) },
  }
}

/** The moves of `placed`, and the action revised when any place moved. */
function outcome(
  label: string,
  placed: readonly Placed[],
  revise: () => RecordedAction,
  after?: Aftermath,
): VisionReplayed {
  const movedPlaces = placed.flatMap((one) => (one.moved === undefined ? [] : [one.moved]))

  return {
    label,
    ...(after !== undefined && { after }),
    movedPlaces,
    ...(movedPlaces.length > 0 && { revised: revise() }),
  }
}

async function clickAt(
  action: ActionOf<"click_at">,
  context: VisionReplayContext,
): Promise<VisionReplayed> {
  const placed = await place(context, action.visual)
  const opensTab = action.opensTab === true
  const after = await watched(
    context.tabs,
    () => context.tabs.page.mouse.click(placed.point.x, placed.point.y),
    { timeout: context.timeout, expectTab: opensTab },
  )

  if (opensTab && !after.openedTab) throw new Error("the tab it opened did not open")

  return outcome(
    `click at "${action.visual.description}"`,
    [placed],
    () => ({ ...action, visual: placed.visual }),
    after,
  )
}

async function typeAt(
  action: ActionOf<"type_at">,
  context: VisionReplayContext,
): Promise<VisionReplayed> {
  const placed = await place(context, action.visual)
  const page = context.tabs.page
  const text = await context.text(action.input)

  if ("secret" in action.input && placed.visual.anchor !== undefined)
    context.spots?.add(page.locator(placed.visual.anchor.css))
  await page.mouse.click(placed.point.x, placed.point.y)
  await page.keyboard.type(text)

  return outcome(`type at "${action.visual.description}"`, [placed], () => ({
    ...action,
    visual: placed.visual,
  }))
}

async function dragAt(
  action: ActionOf<"drag_at">,
  context: VisionReplayContext,
): Promise<VisionReplayed> {
  const from = await place(context, action.visual)
  const to = await place(context, action.to)

  await dragBetween(context.tabs.page.mouse, from.point, to.point)

  return outcome(
    `drag "${action.visual.description}" to "${action.to.description}"`,
    [from, to],
    () => ({ ...action, visual: from.visual, to: to.visual }),
  )
}

async function scrollAt(
  action: ActionOf<"scroll_at">,
  context: VisionReplayContext,
): Promise<VisionReplayed> {
  const placed = await place(context, action.visual)

  await scrollOver(context.tabs.page.mouse, placed.point, action.direction)

  return outcome(`scroll ${action.direction} at "${action.visual.description}"`, [placed], () => ({
    ...action,
    visual: placed.visual,
  }))
}

type Replay<Kind extends RecordedAction["kind"]> = (
  action: ActionOf<Kind>,
  context: VisionReplayContext,
) => Promise<VisionReplayed>

/** How each action taken on a screenshot is replayed. */
export const visionReplays: {
  readonly [Kind in "click_at" | "type_at" | "drag_at" | "scroll_at"]: Replay<Kind>
} = { click_at: clickAt, type_at: typeAt, drag_at: dragAt, scroll_at: scrollAt }
