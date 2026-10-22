/**
 * A device screenshot made safe to show: the boxes of password fields, fields a secret was filled
 * into, and any element showing a secret's value are painted black, then the picture is cut to
 * one element's box when asked. Boxes are in screenshot pixels, as the device's readings give them.
 */
import type { DeviceBox } from "@danwo/runner/runner"
import { PNG } from "pngjs"

/** Paints `boxes` black on `image`. */
function paint(image: PNG, boxes: readonly DeviceBox[]): void {
  for (const box of boxes) {
    const x0 = Math.max(0, Math.floor(box.x))
    const x1 = Math.min(image.width, Math.ceil(box.x + box.width))
    const y0 = Math.max(0, Math.floor(box.y))
    const y1 = Math.min(image.height, Math.ceil(box.y + box.height))

    if (x1 <= x0) continue

    for (let y = y0; y < y1; y++) {
      const row = y * image.width

      image.data.fill(0, (row + x0) * 4, (row + x1) * 4)
      for (let x = x0; x < x1; x++) image.data[(row + x) * 4 + 3] = 255
    }
  }
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, Math.round(value)))
}

/** `image` cut to `box`, kept inside the picture. */
function cut(image: PNG, box: DeviceBox): PNG {
  const left = clamp(box.x, 0, image.width - 1)
  const top = clamp(box.y, 0, image.height - 1)
  const width = clamp(box.width, 1, image.width - left)
  const height = clamp(box.height, 1, image.height - top)
  const out = new PNG({ width, height })

  PNG.bitblt(image, out, left, top, width, height, 0, 0)

  return out
}

/** The PNG `png` with `hidden` painted over, cut to `within` when given. */
export function maskedShot(png: Buffer, hidden: readonly DeviceBox[], within?: DeviceBox): Buffer {
  const image = PNG.sync.read(png)

  paint(image, hidden)

  return PNG.sync.write(within === undefined ? image : cut(image, within))
}
