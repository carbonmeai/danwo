/**
 * The page as an image for vision: a screenshot in CSS pixels, so its coordinates are the ones the
 * mouse takes, with every field that holds a secret painted over. Optionally with numbered marks
 * over the things a person could click (set-of-marks), so the model can point at "mark 7" instead of
 * guessing coordinates. The marks are drawn into the page for the screenshot and removed at once.
 */
import type { Locator, Page } from "playwright-core"

import { HIDE_POINTER } from "../browser/pointer.ts"
import type { Box } from "./image.ts"

/** A numbered region of the screenshot, and what the page says it is. */
export interface Mark {
  readonly id: number
  readonly box: Box
  /** A short description from the page: tag, role and label or text. */
  readonly hint: string
}

/** A screenshot of the viewport, and its marks when it has them. */
export interface Look {
  readonly png: Buffer
  readonly marks: readonly Mark[]
  readonly width: number
  readonly height: number
}

/**
 * Fields a secret was typed into, so screenshots and stored patches never show them. Password
 * inputs are always covered; a secret typed elsewhere adds its element here.
 */
export class SecretSpots {
  private readonly spots: Locator[] = []

  add(element: Locator): void {
    this.spots.push(element)
  }

  /** What to paint over on `page`. */
  masks(page: Page): Locator[] {
    return [
      page.locator("input[type=password]"),
      ...this.spots.filter((spot) => spot.page() === page),
    ]
  }
}

const MARK_LAYER = "danwo-vision-marks"
const MAX_MARKS = 80

/** What a person could click on a page. */
const CLICKABLE =
  "a,button,input,select,textarea,summary,canvas,iframe,video,[role],[onclick],[tabindex],[contenteditable]"

/** An element of the page as the browser lays it out, with what it says about itself. */
interface Laid extends Box {
  readonly hint: string
}

/** Every element that looks clickable, in document order, with its box and words; runs in the page. */
function clickables(selector: string) {
  return [...document.querySelectorAll("body *")]
    .filter(
      (element) => element.matches(selector) || getComputedStyle(element).cursor === "pointer",
    )
    .map((element) => {
      const rect = element.getBoundingClientRect()
      const words =
        element.getAttribute("aria-label") ??
        element.getAttribute("title") ??
        element.getAttribute("placeholder") ??
        (element.textContent ?? "").trim().slice(0, 1_000)

      return {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        hint: [element.tagName.toLowerCase(), element.getAttribute("role") ?? "", words]
          .filter((part) => part !== "")
          .join(" "),
      }
    })
}

/** Whether `box` shows in a viewport of `size`, big enough to point at. */
function inView(box: Box, size: { width: number; height: number }): boolean {
  const big = box.width >= 4 && box.height >= 4
  const across = box.x + box.width > 0 && box.x < size.width
  const down = box.y + box.height > 0 && box.y < size.height

  return big && across && down
}

/** Whether two boxes are the same box, give or take a pixel. */
function sameBox(a: Box, b: Box): boolean {
  return [a.x - b.x, a.y - b.y, a.width - b.width, a.height - b.height].every(
    (difference) => Math.abs(difference) < 2,
  )
}

/** The regions to mark: in view, one per box, at most `MAX_MARKS`. */
function regionsOf(laid: readonly Laid[], size: { width: number; height: number }): Laid[] {
  const kept: Laid[] = []

  for (const one of laid) {
    if (kept.length >= MAX_MARKS) break
    if (inView(one, size) && !kept.some((other) => sameBox(other, one))) kept.push(one)
  }

  return kept
}

/** Draws numbered boxes over `regions` in a layer of their own; runs in the page. */
function drawMarks(input: {
  layer: string
  regions: { x: number; y: number; width: number; height: number }[]
}) {
  const layer = document.createElement("div")

  layer.id = input.layer
  layer.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:2147483647"

  for (const [index, region] of input.regions.entries()) {
    const box = document.createElement("div")
    const label = document.createElement("span")

    box.style.cssText = `position:fixed;left:${region.x}px;top:${region.y}px;width:${region.width}px;height:${region.height}px;outline:2px solid #e11d48;box-sizing:border-box`
    label.textContent = String(index + 1)
    label.style.cssText =
      "position:absolute;left:0;top:0;transform:translateY(-100%);background:#e11d48;color:#fff;font:bold 11px/13px sans-serif;padding:0 3px"
    box.append(label)
    layer.append(box)
  }

  document.documentElement.append(layer)
}

/**
 * A plain screenshot of the viewport in CSS pixels, with secret fields painted over. The caret is
 * left as it is, since hiding it writes an inline style on every field of the page.
 */
export async function screenshot(page: Page, spots: SecretSpots): Promise<Buffer> {
  return page.screenshot({
    type: "png",
    scale: "css",
    caret: "initial",
    mask: spots.masks(page),
    animations: "disabled",
    style: HIDE_POINTER,
  })
}

/** The viewport's size in CSS pixels. */
async function viewportOf(page: Page): Promise<{ width: number; height: number }> {
  return (
    page.viewportSize() ?? (await page.evaluate(() => ({ width: innerWidth, height: innerHeight })))
  )
}

/** A screenshot of the viewport for the model, with numbered marks over interactive regions. */
export async function look(page: Page, spots: SecretSpots, withMarks = true): Promise<Look> {
  const size = await viewportOf(page)
  const regions = withMarks ? regionsOf(await page.evaluate(clickables, CLICKABLE), size) : []

  if (regions.length > 0) await page.evaluate(drawMarks, { layer: MARK_LAYER, regions })

  try {
    const png = await screenshot(page, spots)
    const marks = regions.map((region, index) => ({
      id: index + 1,
      box: { x: region.x, y: region.y, width: region.width, height: region.height },
      hint: region.hint,
    }))

    return { png, marks, ...size }
  } finally {
    if (regions.length > 0)
      await page
        .evaluate((layer) => document.getElementById(layer)?.remove(), MARK_LAYER)
        .catch(() => undefined)
  }
}

/** How long a mark's words may be in the model's list, cut only once they are redacted. */
const HINT_CHARS = 64

/** The marks as lines of text for the model: `7: button "Save" at 120,40 80×24`. */
export function marksText(marks: readonly Mark[], redact: (text: string) => string): string {
  return marks
    .map(
      (mark) =>
        `${mark.id}: ${redact(mark.hint).slice(0, HINT_CHARS)} at ${Math.round(mark.box.x)},${Math.round(mark.box.y)} ${Math.round(mark.box.width)}×${Math.round(mark.box.height)}`,
    )
    .join("\n")
}

/** What the text view cannot show of a page: its canvases, unnamed clickables and closed frames. */
export interface VisualGaps {
  readonly canvases: number
  readonly unnamed: number
  readonly frames: number
}

/**
 * Canvases and clickable elements with their boxes, each with whether it has a name (a canvas
 * never has one the text view shows); runs in the page.
 */
function gapCandidates() {
  const candidates = [
    ...document.querySelectorAll("canvas,button,a[href],[role=button],[onclick]"),
  ].map((element) => {
    const rect = element.getBoundingClientRect()
    const label = element.getAttribute("aria-label") ?? element.getAttribute("title") ?? ""
    const canvas = element.tagName === "CANVAS"
    const named =
      label.trim() !== "" ||
      (element.textContent ?? "").trim() !== "" ||
      element.querySelector("img[alt]:not([alt=''])") !== null

    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, canvas, named }
  })

  return { candidates, viewport: { width: innerWidth, height: innerHeight } }
}

/** Counts what of the page only an image shows: canvases and unnamed clickables in view. */
async function countGaps(page: Page): Promise<{ canvases: number; unnamed: number }> {
  const found = await page.evaluate(gapCandidates).catch(() => undefined)

  if (found === undefined) return { canvases: 0, unnamed: 0 }

  const shown = found.candidates.filter((one) => inView(one, found.viewport))

  return {
    canvases: shown.filter((one) => one.canvas).length,
    unnamed: shown.filter((one) => !one.canvas && !one.named).length,
  }
}

/**
 * What of the page the text view does not show: canvases, clickable elements with no name, and
 * frames whose content the view left empty (`- iframe [ref=…]` with nothing under it).
 */
export async function visualGaps(page: Page, tree: string): Promise<VisualGaps> {
  const counted = await countGaps(page)
  /* A frame with content ends its line with a colon and lists the content under it. */
  const frames = tree
    .split("\n")
    .filter((line) => /^\s*- iframe\b/.test(line) && !line.trimEnd().endsWith(":")).length

  return { ...counted, frames }
}

/** Whether the page has anything the text view misses. */
export function hasGaps(gaps: VisualGaps): boolean {
  return gaps.canvases + gaps.unnamed + gaps.frames > 0
}

/** One line telling the model what the text view misses, and how to see it. */
export function gapsLine(gaps: VisualGaps): string {
  const parts = [
    gaps.canvases > 0 && `${gaps.canvases} canvas${gaps.canvases > 1 ? "es" : ""}`,
    gaps.unnamed > 0 &&
      `${gaps.unnamed} clickable element${gaps.unnamed > 1 ? "s" : ""} with no name`,
    gaps.frames > 0 &&
      `${gaps.frames} frame${gaps.frames > 1 ? "s" : ""} whose content is not listed`,
  ].filter((part) => part !== false)

  return `Not in the text above: ${parts.join(", ")}. Call \`look\` to see the page as an image and act on it with the *_at tools.`
}
