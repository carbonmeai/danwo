/**
 * The little image work vision needs, in plain arrays: PNGs decoded to grayscale, crops, shrinking
 * by whole factors, and a normalized cross-correlation score that says how alike two equally sized
 * gray images are, from -1 (opposite) through 0 (unrelated) to 1 (the same up to brightness and
 * contrast). Searching slides a patch over an area and keeps the best and the runner-up.
 */
import { PNG } from "pngjs"

/** A grayscale image: one 0–255 value per pixel, row by row. */
export interface Gray {
  readonly width: number
  readonly height: number
  readonly pixels: Float32Array
}

export interface Box {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/** A PNG's pixels as gray, by the usual luma weights; transparent pixels count as white. */
export function decodeGray(png: Uint8Array): Gray {
  const image = PNG.sync.read(Buffer.from(png))
  const pixels = new Float32Array(image.width * image.height)

  for (let at = 0; at < pixels.length; at++) {
    const [r = 0, g = 0, b = 0, a = 255] = image.data.subarray(at * 4, at * 4 + 4)
    const luma = 0.299 * r + 0.587 * g + 0.114 * b
    const alpha = a / 255

    pixels[at] = luma * alpha + 255 * (1 - alpha)
  }

  return { width: image.width, height: image.height, pixels }
}

/** A gray image as a PNG, for storing a patch in a recording. */
export function encodeGray(image: Gray): Buffer {
  const png = new PNG({ width: image.width, height: image.height })

  for (let at = 0; at < image.pixels.length; at++) {
    const value = Math.round(image.pixels[at] ?? 0)

    png.data.set([value, value, value, 255], at * 4)
  }

  return PNG.sync.write(png)
}

/** The part of `image` inside `box`, clipped to the image; pixels outside count as white. */
export function crop(image: Gray, box: Box): Gray {
  const width = Math.max(1, Math.round(box.width))
  const height = Math.max(1, Math.round(box.height))
  const pixels = new Float32Array(width * height).fill(255)
  const left = Math.round(box.x)
  const top = Math.round(box.y)

  for (let row = 0; row < height; row++) {
    const y = top + row

    if (y < 0 || y >= image.height) continue

    for (let column = 0; column < width; column++) {
      const x = left + column

      if (x >= 0 && x < image.width)
        pixels[row * width + column] = image.pixels[y * image.width + x] ?? 255
    }
  }

  return { width, height, pixels }
}

/** `image` made `factor` times smaller on each side, each new pixel the mean of its block. */
export function shrink(image: Gray, factor: number): Gray {
  if (factor <= 1) return image

  const width = Math.max(1, Math.floor(image.width / factor))
  const height = Math.max(1, Math.floor(image.height / factor))
  const pixels = new Float32Array(width * height)
  const area = factor * factor

  for (let row = 0; row < height; row++)
    for (let column = 0; column < width; column++) {
      let sum = 0

      for (let dy = 0; dy < factor; dy++)
        for (let dx = 0; dx < factor; dx++)
          sum += image.pixels[(row * factor + dy) * image.width + column * factor + dx] ?? 255

      pixels[row * width + column] = sum / area
    }

  return { width, height, pixels }
}

/** Mean and spread of a window of `image` the size of `width` × `height` at `x`, `y`. */
function windowStats(image: Gray, x: number, y: number, width: number, height: number) {
  let sum = 0
  let squares = 0

  for (let row = 0; row < height; row++)
    for (let column = 0; column < width; column++) {
      const value = image.pixels[(y + row) * image.width + x + column] ?? 255

      sum += value
      squares += value * value
    }

  const count = width * height
  const mean = sum / count

  return { mean, spread: Math.sqrt(Math.max(0, squares / count - mean * mean)) }
}

type Stats = ReturnType<typeof windowStats>

/** A spread below this is a flat window: one colour, nothing to correlate. */
const FLAT = 2

/** Likeness when either window is flat: the same flat colour is alike, anything else unrelated. */
function flatLikeness(own: Stats, there: Stats): number {
  const bothFlat = own.spread < FLAT && there.spread < FLAT

  return bothFlat && Math.abs(own.mean - there.mean) < 8 ? 1 : 0
}

/** The summed product of both windows' deviations from their means. */
function covariance(
  image: Gray,
  patch: Gray,
  at: { x: number; y: number },
  means: [number, number],
) {
  let sum = 0

  for (let row = 0; row < patch.height; row++)
    for (let column = 0; column < patch.width; column++) {
      const a = (patch.pixels[row * patch.width + column] ?? 255) - means[0]
      const b = (image.pixels[(at.y + row) * image.width + at.x + column] ?? 255) - means[1]

      sum += a * b
    }

  return sum
}

/**
 * How alike `patch` is to the window of `image` at `x`, `y`: their normalized cross-correlation.
 * Two flat windows of the same brightness count as alike (1); a flat and a busy one as unrelated.
 */
function likenessAt(image: Gray, patch: Gray, x: number, y: number): number {
  const own = windowStats(patch, 0, 0, patch.width, patch.height)
  const there = windowStats(image, x, y, patch.width, patch.height)

  if (own.spread < FLAT || there.spread < FLAT) return flatLikeness(own, there)

  const sum = covariance(image, patch, { x, y }, [own.mean, there.mean])

  return sum / (patch.width * patch.height * own.spread * there.spread)
}

/** How alike two images of the same size are. */
export function likeness(a: Gray, b: Gray): number {
  if (a.width !== b.width || a.height !== b.height) return 0

  return likenessAt(a, b, 0, 0)
}

/** Where a search placed the patch best, and how well the best place that is not it scored. */
export interface Found {
  /** The patch's top-left corner in the searched image's pixels. */
  readonly x: number
  readonly y: number
  readonly score: number
  /** The best score of a place that does not overlap the best one; 0 when there is none. */
  readonly runnerUp: number
}

/** Positions `from`..`to` in steps of `step`, always including `to`. */
function positions(from: number, to: number, step: number): number[] {
  const all: number[] = []

  for (let at = from; at < to; at += step) all.push(at)
  if (to >= from) all.push(to)

  return all
}

/** Every place the patch fits in `area`, scored. */
function scoreAll(image: Gray, patch: Gray, area: Box, step: number) {
  const right = Math.min(image.width - patch.width, Math.round(area.x + area.width - patch.width))
  const bottom = Math.min(
    image.height - patch.height,
    Math.round(area.y + area.height - patch.height),
  )
  const left = Math.max(0, Math.round(area.x))
  const top = Math.max(0, Math.round(area.y))
  const scored: { x: number; y: number; score: number }[] = []

  for (const y of positions(top, bottom, step))
    for (const x of positions(left, right, step))
      scored.push({ x, y, score: likenessAt(image, patch, x, y) })

  return scored
}

/** The best place for `patch` within `area` of `image` (all of it by default), and the runner-up. */
export function search(image: Gray, patch: Gray, area?: Box, step = 1): Found | undefined {
  const scored = scoreAll(
    image,
    patch,
    area ?? { x: 0, y: 0, width: image.width, height: image.height },
    step,
  )
  const best = scored.reduce<(typeof scored)[number] | undefined>(
    (top, entry) => (top === undefined || entry.score > top.score ? entry : top),
    undefined,
  )

  if (best === undefined) return undefined

  const apart = scored.filter(
    (entry) =>
      Math.abs(entry.x - best.x) >= patch.width / 2 ||
      Math.abs(entry.y - best.y) >= patch.height / 2,
  )
  const runnerUp = apart.reduce((top, entry) => Math.max(top, entry.score), 0)

  return { x: best.x, y: best.y, score: best.score, runnerUp }
}
