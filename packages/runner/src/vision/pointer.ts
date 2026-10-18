/** The mouse gestures actions on a screenshot make, shared by live steps and replays. */
import type { Mouse } from "playwright-core"

import type { Point } from "./visual.ts"

/** How far one scroll moves, in CSS pixels. */
const SCROLL_STEP = 600

/** Presses at `from`, moves to `to` in small steps, and lets go. */
export async function dragBetween(mouse: Mouse, from: Point, to: Point): Promise<void> {
  await mouse.move(from.x, from.y)
  await mouse.down()
  await mouse.move(to.x, to.y, { steps: 8 })
  await mouse.up()
}

/** Scrolls one step up or down with the pointer over `at`. */
export async function scrollOver(mouse: Mouse, at: Point, direction: "up" | "down"): Promise<void> {
  await mouse.move(at.x, at.y)
  await mouse.wheel(0, direction === "down" ? SCROLL_STEP : -SCROLL_STEP)
}
