/**
 * A place on the page found by how it looks, for actions taken on a screenshot. A recording keeps
 * a small gray patch of the screen around the point, the element the point sat in (by a CSS path
 * that picks out exactly one element) and where in that element it was, as a fraction of its box.
 *
 * A replay goes to the same spot of the same element and checks the patch still matches there. When
 * it does not, and the replay may look for moved targets, it searches the element's area (or the
 * viewport) for the patch, coarse to fine, and takes the best place only if it clearly beats every
 * other. Nothing is acted on below the thresholds: the replay stops with the score it found.
 */
import type { Page } from "playwright-core"

import type { VisualTarget } from "../replay/trace.ts"
import {
  type Box,
  crop,
  decodeGray,
  encodeGray,
  type Found,
  type Gray,
  likeness,
  search,
  shrink,
} from "./image.ts"
import { screenshot, type SecretSpots } from "./screen.ts"

export type { VisualTarget } from "../replay/trace.ts"

/** Side of a stored patch, in CSS pixels. */
const PATCH = 48
/** Likeness at the recorded spot that counts as the same picture. */
const ACCEPT = 0.9
/** Likeness a searched place needs, and how far it must beat any other place, to count as moved. */
const RELOCATE = 0.85
const MARGIN = 0.05
/** Searching works on the screen made this many times smaller, then refines at full size. */
const COARSE = 4
const REFINE = 6
/** How long a replay waits for a patch that is not there yet, e.g. a canvas still drawing. */
const SETTLE_MS = 2_000
const POLL_MS = 200

export interface Point {
  readonly x: number
  readonly y: number
}

/** The element a point sat in, as a CSS path unique on the page, and its box. */
interface Anchor {
  readonly css: string
  readonly box: Box
}

/** One element on the way up from the element under a point, as a CSS path step describes it. */
interface PathStep {
  readonly tag: string
  readonly testId: string | null
  readonly id: string
  /** Its position among its parent's children of the same tag (1-based), and how many there are. */
  readonly nth: number
  readonly ofTag: number
}

/**
 * The element under `point`, its box, and the elements from it up to the document's root; runs in
 * the page.
 */
function elementsUpFrom(point: { x: number; y: number }) {
  const hit = document.elementFromPoint(point.x, point.y)

  if (hit === null) return undefined

  const steps: PathStep[] = []

  for (
    let at: Element | null = hit;
    at !== null && at !== document.documentElement;
    at = at.parentElement
  ) {
    const tag = at.tagName
    const kin = [...(at.parentElement?.children ?? [])].filter((other) => other.tagName === tag)

    steps.push({
      tag: tag.toLowerCase(),
      testId: at.getAttribute("data-testid"),
      id: at.id,
      nth: kin.indexOf(at) + 1,
      ofTag: kin.length,
    })
  }

  const rect = hit.getBoundingClientRect()

  return { steps, box: { x: rect.x, y: rect.y, width: rect.width, height: rect.height } }
}

/** `text` quoted for a CSS attribute value. */
function quoted(text: string): string {
  return JSON.stringify(text)
}

/** One step of a CSS path: by test id or id when it has one, else by tag and position. */
function cssStep(step: PathStep): { readonly css: string; readonly named: boolean } {
  if (step.testId !== null) return { css: `[data-testid=${quoted(step.testId)}]`, named: true }
  if (step.id !== "") return { css: `[id=${quoted(step.id)}]`, named: true }

  return { css: step.ofTag > 1 ? `${step.tag}:nth-of-type(${step.nth})` : step.tag, named: false }
}

/** The CSS path up from the hit element to the first element with a test id or an id. */
function cssPath(steps: readonly PathStep[]): string {
  const parts: string[] = []

  for (const step of steps) {
    const part = cssStep(step)

    parts.unshift(part.css)
    if (part.named) break
  }

  return parts.join(" > ")
}

/** The element under `point` as a CSS path that picks out only it, and its box. */
async function anchorAt(page: Page, point: Point): Promise<Anchor | undefined> {
  const found = await page.evaluate(elementsUpFrom, point).catch(() => undefined)

  if (found === undefined) return undefined

  const css = cssPath(found.steps)
  const count = await page
    .locator(css)
    .count()
    .catch(() => 0)

  return count === 1 ? { css, box: found.box } : undefined
}

/** The gray screen of `page` now, with secret fields painted over. */
async function grayScreen(page: Page, spots: SecretSpots): Promise<Gray> {
  return decodeGray(await screenshot(page, spots))
}

function patchBox(point: Point): Box {
  return { x: point.x - PATCH / 2, y: point.y - PATCH / 2, width: PATCH, height: PATCH }
}

/** Where `point` sits in `box`, as fractions of its size. */
function fractionIn(box: Box, point: Point): Point {
  return {
    x: box.width > 0 ? (point.x - box.x) / box.width : 0,
    y: box.height > 0 ? (point.y - box.y) / box.height : 0,
  }
}

/** Records the place at `point` for a replay to find again. */
export async function captureVisual(
  page: Page,
  point: Point,
  description: string,
  spots: SecretSpots,
): Promise<VisualTarget> {
  const screen = await grayScreen(page, spots)
  const patch = crop(screen, patchBox(point))
  const anchor = await anchorAt(page, point)

  return {
    description,
    patch: encodeGray(patch).toString("base64"),
    point: { x: Math.round(point.x), y: Math.round(point.y) },
    ...(anchor !== undefined && { anchor: { css: anchor.css, at: fractionIn(anchor.box, point) } }),
  }
}

/** Where the anchor element is now, if it is on the page. */
async function anchorBox(page: Page, visual: VisualTarget): Promise<Box | undefined> {
  if (visual.anchor === undefined) return undefined

  const element = page.locator(visual.anchor.css)
  const count = await element.count().catch(() => 0)

  if (count !== 1) return undefined

  return (await element.boundingBox({ timeout: 1_000 }).catch(() => null)) ?? undefined
}

/** Where the recording says the point is on the page now: in its element, else where it was. */
function expectedPoint(visual: VisualTarget, box: Box | undefined): Point {
  if (box === undefined || visual.anchor === undefined) return visual.point

  return { x: box.x + visual.anchor.at.x * box.width, y: box.y + visual.anchor.at.y * box.height }
}

/** How a replay found a recorded place. */
export interface VisualFound {
  readonly point: Point
  readonly score: number
  /** The place was not where the recording put it and was found by searching. */
  readonly moved: boolean
}

/** Why a recorded place was not found, with the best score seen. */
class VisualMissing extends Error {
  readonly score: number

  constructor(description: string, score: number, why: string) {
    super(`"${description}" ${why} (best likeness ${score.toFixed(2)})`)
    this.name = "VisualMissing"
    this.score = score
  }
}

/** Searches `area` for `patch`: on a shrunk screen first, then around that place at full size. */
function searchFor(screen: Gray, patch: Gray, area: Box): Found | undefined {
  const coarse = search(shrink(screen, COARSE), shrink(patch, COARSE), {
    x: area.x / COARSE,
    y: area.y / COARSE,
    width: area.width / COARSE,
    height: area.height / COARSE,
  })

  if (coarse === undefined) return undefined

  const around = {
    x: coarse.x * COARSE - REFINE,
    y: coarse.y * COARSE - REFINE,
    width: PATCH + 2 * REFINE,
    height: PATCH + 2 * REFINE,
  }
  const fine = search(screen, patch, around)

  return fine === undefined ? undefined : { ...fine, runnerUp: coarse.runnerUp }
}

/** The area searched for a moved place: around its element, or the whole viewport. */
function searchArea(screen: Gray, box: Box | undefined): Box {
  if (box === undefined) return { x: 0, y: 0, width: screen.width, height: screen.height }

  return {
    x: box.x - PATCH,
    y: box.y - PATCH,
    width: box.width + 2 * PATCH,
    height: box.height + 2 * PATCH,
  }
}

/** Looks once: the recorded place where it should be, else (when allowed) wherever it moved. */
async function findOnce(
  page: Page,
  visual: VisualTarget,
  patch: Gray,
  options: { readonly spots: SecretSpots; readonly relocate: boolean },
): Promise<VisualFound | { readonly best: number; readonly why: string }> {
  const screen = await grayScreen(page, options.spots)
  const box = await anchorBox(page, visual)
  const point = expectedPoint(visual, box)
  const score = likeness(crop(screen, patchBox(point)), patch)

  if (score >= ACCEPT) return { point, score, moved: false }
  if (!options.relocate) return { best: score, why: "does not look the same where it was" }

  const found = searchFor(screen, patch, searchArea(screen, box))

  if (found === undefined) return { best: score, why: "is not on the screen" }

  const best = Math.max(score, found.score)

  if (found.score < RELOCATE) return { best, why: "is not on the screen" }
  if (found.score - found.runnerUp < MARGIN)
    return { best, why: "matches more than one place on the screen" }

  return {
    point: { x: found.x + PATCH / 2, y: found.y + PATCH / 2 },
    score: found.score,
    moved: true,
  }
}

/**
 * Finds a recorded place on the page, waiting a little for it to be drawn; throws VisualMissing
 * when it is not there with enough likeness. `relocate` allows searching for a moved place.
 */
export async function findVisual(
  page: Page,
  visual: VisualTarget,
  options: { readonly spots: SecretSpots; readonly relocate: boolean; readonly timeout?: number },
): Promise<VisualFound> {
  const patch = decodeGray(Buffer.from(visual.patch, "base64"))
  const deadline = Date.now() + Math.min(options.timeout ?? SETTLE_MS, SETTLE_MS)

  for (;;) {
    const outcome = await findOnce(page, visual, patch, options)

    if ("point" in outcome) return outcome
    if (Date.now() >= deadline)
      throw new VisualMissing(visual.description, outcome.best, outcome.why)

    await new Promise((resolve) => setTimeout(resolve, POLL_MS))
  }
}

/** The recording's place moved to `point`: the same picture, re-anchored where it was found. */
export async function movedTo(
  page: Page,
  visual: VisualTarget,
  point: Point,
): Promise<VisualTarget> {
  const box = await anchorBox(page, visual)

  return {
    ...visual,
    point: { x: Math.round(point.x), y: Math.round(point.y) },
    ...(visual.anchor !== undefined &&
      box !== undefined && { anchor: { ...visual.anchor, at: fractionIn(box, point) } }),
  }
}
