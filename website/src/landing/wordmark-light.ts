/**
 * The arithmetic behind the footer's wordmark light: the wordmark's outline read from the brand
 * file, where a pointer sits in the wordmark's own units, how the light eases after it, and the
 * path a light takes on its own where there is no pointer.
 */

/** The wordmark's outline and the box it is drawn in, in the SVG's own units. */
export interface WordmarkShape {
  readonly d: string
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/** A point in the wordmark's units. */
export interface Point {
  readonly x: number
  readonly y: number
}

/** The outline and view box of an outlined wordmark SVG with one path. */
export function wordmarkShape(svg: string): WordmarkShape {
  const box = /viewBox="([^"]+)"/
    .exec(svg)?.[1]
    ?.split(/[\s,]+/)
    .map(Number)
  const d = /\sd="([^"]+)"/.exec(svg)?.[1]

  if (!box || box.length !== 4 || box.some((n) => !Number.isFinite(n)) || !d)
    throw new Error("the wordmark SVG needs a viewBox and one path")

  const [x = 0, y = 0, width = 0, height = 0] = box

  return { d, x, y, width, height }
}

/** Where a pointer at `client` falls in the wordmark's units, given where the SVG is on screen. */
export function toWordmark(
  client: Point,
  rect: {
    readonly left: number
    readonly top: number
    readonly width: number
    readonly height: number
  },
  shape: WordmarkShape,
): Point {
  const scale = shape.width / Math.max(rect.width, 1)

  return {
    x: shape.x + (client.x - rect.left) * scale,
    y: shape.y + (client.y - rect.top) * scale,
  }
}

/** `current` moved toward `target` over `ms` milliseconds, settling with time constant `tau`. */
export function approach(current: number, target: number, ms: number, tau: number): number {
  return target + (current - target) * Math.exp(-Math.max(ms, 0) / tau)
}

/** How long a light takes to cross the wordmark and back when it moves on its own. */
export const SWEEP_MS = 9000

/** Where a light that moves on its own sits at `ms`: across the letters and back, at mid height. */
export function sweepPoint(ms: number, shape: WordmarkShape): Point {
  const phase = (ms % SWEEP_MS) / SWEEP_MS
  const across = 0.5 - 0.5 * Math.cos(phase * 2 * Math.PI)

  return {
    x: shape.x + shape.width * (0.08 + 0.84 * across),
    y: shape.y + shape.height * 0.45,
  }
}

/** Where the light rests when the visitor asked for no motion: over the middle letters. */
export function restingPoint(shape: WordmarkShape): Point {
  return { x: shape.x + shape.width * 0.6, y: shape.y + shape.height * 0.45 }
}
