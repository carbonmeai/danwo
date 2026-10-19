import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

import { describe, expect, it } from "vitest"

import {
  approach,
  capsule,
  restingPoint,
  SWEEP_MS,
  sweepPoint,
  toWordmark,
  wordmarkShape,
} from "../src/landing/wordmark-light.ts"

const WORDMARK = readFileSync(
  fileURLToPath(new URL("../../brand/svg/danwo-wordmark-white.svg", import.meta.url)),
  "utf8",
)

describe("the footer's wordmark light", () => {
  it("reads the outline and view box from the brand's wordmark", () => {
    const shape = wordmarkShape(WORDMARK)

    expect(shape.d.startsWith("M")).toBe(true)
    expect(shape.width).toBeGreaterThan(shape.height)
    expect([shape.x, shape.y, shape.width, shape.height].every(Number.isFinite)).toBe(true)
  })

  it("keeps the accents, drawn as lines, as filled outlines beside the letters", () => {
    const shape = wordmarkShape(WORDMARK)
    const lines = WORDMARK.match(/<line\b/g)?.length ?? 0

    expect(lines).toBeGreaterThan(0)
    expect(shape.d.match(/A/g)?.length).toBe(lines * 2)
  })

  it("draws a round-capped line as two sides and two half circles around it", () => {
    const outline = capsule('<line x1="0" y1="0" x2="100" y2="0" stroke-width="20"/>')

    expect(outline).toBe(
      "M0.00 10.00 L100.00 10.00 A10 10 0 0 0 100.00 -10.00 L0.00 -10.00 A10 10 0 0 0 0.00 10.00Z",
    )
  })

  it("refuses an SVG with no path or no view box", () => {
    expect(() => wordmarkShape('<svg viewBox="0 0 1 1"></svg>')).toThrow(/one path/)
    expect(() => wordmarkShape('<svg><path d="M0 0"/></svg>')).toThrow(/viewBox/)
  })

  it("places a pointer in the wordmark's units, whatever size it is drawn at", () => {
    const shape = { d: "M0 0", x: 30, y: -765, width: 3145, height: 778 }
    const rect = { left: 100, top: 200, width: 1240, height: 306.8 }

    expect(toWordmark({ x: 100, y: 200 }, rect, shape)).toEqual({ x: 30, y: -765 })
    expect(toWordmark({ x: 1340, y: 200 }, rect, shape).x).toBeCloseTo(30 + 3145)
    expect(toWordmark({ x: 720, y: 200 + 153.4 }, rect, shape).y).toBeCloseTo(-765 + 389, 0)
  })

  it("eases toward a target without overshooting, and stays put for no time", () => {
    expect(approach(0, 10, 0, 90)).toBe(0)
    expect(approach(0, 10, 90, 90)).toBeCloseTo(10 * (1 - Math.exp(-1)))
    expect(approach(0, 10, 10_000, 90)).toBeCloseTo(10)
    expect(approach(0, 10, -5, 90)).toBe(0)
  })

  it("sweeps across the letters and back, inside the wordmark", () => {
    const shape = wordmarkShape(WORDMARK)
    const start = sweepPoint(0, shape)
    const middle = sweepPoint(SWEEP_MS / 2, shape)

    expect(middle.x).toBeGreaterThan(start.x)
    expect(sweepPoint(SWEEP_MS, shape).x).toBeCloseTo(start.x)

    for (const ms of [0, 1000, 4500, 8000]) {
      const point = sweepPoint(ms, shape)

      expect(point.x).toBeGreaterThanOrEqual(shape.x)
      expect(point.x).toBeLessThanOrEqual(shape.x + shape.width)
    }

    expect(restingPoint(shape).y).toBe(start.y)
  })
})
