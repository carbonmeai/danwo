import { writeFile } from "node:fs/promises"

import { PNG } from "pngjs"
import { describe, expect, it } from "vitest"

import { DeviceEyes } from "../src/device/agent/eyes.ts"
import type { DeviceNode, DeviceTarget } from "../src/device/types.ts"

/** A gray screen with a checkered 80-pixel badge whose top left corner is at (`x`, `y`). */
function screen(x: number, y: number): Buffer {
  const png = new PNG({ width: 400, height: 800 })

  for (let row = 0; row < 800; row++)
    for (let col = 0; col < 400; col++) {
      const inside = col >= x && col < x + 80 && row >= y && row < y + 80
      const value = inside ? ((((col - x) >> 3) + ((row - y) >> 3)) % 2 === 0 ? 20 : 240) : 128

      png.data.set([value, value, value, 255], (row * 400 + col) * 4)
    }

  return PNG.sync.write(png)
}

/** A device whose screenshot shows the badge where `at` says. */
function device(at: { x: number; y: number }): DeviceTarget {
  return {
    platform: "android",
    app: "x",
    startApp: async () => ({ relaunched: undefined }),
    openLink: async () => undefined,
    read: async () => ({ nodes: [] }),
    foreground: async () => ({ package: "x", browser: false }),
    tap: async () => undefined,
    fill: async () => undefined,
    back: async () => undefined,
    screenshot: async (path) => {
      await writeFile(path, screen(at.x, at.y))

      return true
    },
  }
}

const icon: DeviceNode = {
  ref: "e1",
  role: "button",
  name: "",
  text: "",
  editable: false,
  password: false,
  enabled: true,
  box: { x: 100, y: 200, width: 80, height: 80 },
}

describe("the device's eyes", () => {
  it("looks at a halved screen with a mark on each control", async () => {
    const eyes = new DeviceEyes(device({ x: 100, y: 200 }))
    const look = await eyes.look([icon])

    expect(look).toMatchObject({ width: 200, height: 400, marks: [{ number: 1, x: 70, y: 120 }] })
    await eyes.close()
  })

  it("finds a recorded place where it was, and where it moved only when allowed", async () => {
    const at = { x: 100, y: 200 }
    const eyes = new DeviceEyes(device(at))
    const visual = await eyes.capture([], { x: 140, y: 240 }, "the checkered badge")

    if (visual === undefined) throw new Error("no capture")
    expect(await eyes.find([], visual, false)).toEqual({ x: 140, y: 240, moved: false })

    at.x = 220
    at.y = 500
    expect(await eyes.find([], visual, false)).toMatch(/does not look the same/)
    expect(await eyes.find([], visual, true)).toEqual({ x: 260, y: 540, moved: true })
    await eyes.close()
  })

  it("paints password fields over", async () => {
    const eyes = new DeviceEyes(device({ x: 100, y: 200 }))
    const field = { ...icon, role: "textbox", editable: true, password: true }
    const image = await eyes.screen([field])

    expect(image?.data[(240 * 400 + 140) * 4]).toBe(0)
    await eyes.close()
  })
})
