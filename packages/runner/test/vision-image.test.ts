/** The image work vision rests on: likeness scores and searching a screen for a patch. */
import { describe, expect, it } from "vitest"

import {
  crop,
  decodeGray,
  encodeGray,
  type Gray,
  likeness,
  search,
  shrink,
} from "../src/vision/image.ts"

/** A gray image from a function of x and y. */
function draw(width: number, height: number, at: (x: number, y: number) => number): Gray {
  const pixels = new Float32Array(width * height)

  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) pixels[y * width + x] = at(x, y)

  return { width, height, pixels }
}

/** A white screen with a dark cross whose centre is at `cx`, `cy`. */
function crossAt(cx: number, cy: number): Gray {
  return draw(120, 80, (x, y) =>
    (Math.abs(x - cx) < 2 && Math.abs(y - cy) < 10) ||
    (Math.abs(y - cy) < 2 && Math.abs(x - cx) < 10)
      ? 20
      : 240,
  )
}

describe("vision image work", () => {
  it("scores the same picture 1, its negative -1 and a flat window apart from a busy one 0", () => {
    const patch = crop(crossAt(30, 30), { x: 18, y: 18, width: 24, height: 24 })
    const negative = { ...patch, pixels: patch.pixels.map((value) => 255 - value) }
    const flat = draw(24, 24, () => 240)

    expect(likeness(patch, patch)).toBeCloseTo(1)
    expect(likeness(patch, negative)).toBeCloseTo(-1)
    expect(likeness(patch, flat)).toBe(0)
    expect(
      likeness(
        flat,
        draw(24, 24, () => 241),
      ),
    ).toBe(1)
  })

  it("finds a patch where it moved, and says how far ahead of anything else it is", () => {
    const patch = crop(crossAt(30, 30), { x: 18, y: 18, width: 24, height: 24 })
    const found = search(crossAt(80, 50), patch)

    expect(found).toMatchObject({ x: 68, y: 38 })
    expect(found?.score).toBeCloseTo(1)
    expect(found?.runnerUp).toBeLessThan(0.6)
  })

  it("keeps likeness under brightness changes and round-trips through PNG", () => {
    const patch = crop(crossAt(30, 30), { x: 18, y: 18, width: 24, height: 24 })
    const brighter = {
      ...patch,
      pixels: patch.pixels.map((value) => Math.min(255, value * 0.9 + 20)),
    }
    const stored = decodeGray(encodeGray(patch))

    expect(likeness(patch, brighter)).toBeGreaterThan(0.99)
    expect(likeness(patch, stored)).toBeGreaterThan(0.99)
    expect(shrink(patch, 4)).toMatchObject({ width: 6, height: 6 })
  })
})
