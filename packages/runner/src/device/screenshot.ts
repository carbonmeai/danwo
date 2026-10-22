/**
 * `toHaveScreenshot` on a device: the element's box cut from a screenshot of the device (or the
 * whole screen for `expect(screen)`), compared with its baseline as on the web. Password fields
 * and the elements a test masks are painted over in both, and the status bar is left out of a
 * whole-screen picture, since its clock changes from run to run.
 */
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { PNG } from "pngjs"

import { compareScreenshot, ScreenshotMismatch } from "../assert/screenshot.ts"
import type { VisualOptions } from "../assert/visual.ts"
import { DanwoError } from "../support/codes.ts"
import type { DeviceLocator } from "./locator.ts"
import { resolveChain } from "./match.ts"
import type { DeviceBox, DeviceNode } from "./types.ts"

/** The top of the screen a whole-screen picture leaves out: the status bar, in screen pixels. */
const STATUS_BAR = 64

/** `box` of `image` as a PNG, with `hidden` boxes painted black. */
function cut(image: PNG, box: DeviceBox, hidden: readonly DeviceBox[]): Buffer {
  const left = Math.max(0, Math.round(box.x))
  const top = Math.max(0, Math.round(box.y))
  const width = Math.max(1, Math.min(image.width - left, Math.round(box.width)))
  const height = Math.max(1, Math.min(image.height - top, Math.round(box.height)))
  const out = new PNG({ width, height })

  PNG.bitblt(image, out, left, top, width, height, 0, 0)

  for (const each of hidden) {
    const x0 = Math.max(0, Math.round(each.x) - left)
    const x1 = Math.min(width, Math.round(each.x + each.width) - left)

    for (
      let y = Math.max(0, Math.round(each.y) - top);
      y < Math.min(height, Math.round(each.y + each.height) - top);
      y++
    )
      if (x1 > x0) out.data.fill(0, (y * width + x0) * 4, (y * width + x1) * 4)
  }

  return PNG.sync.write(out)
}

/** The boxes painted over: password fields, and whatever the masks match. */
function hiddenBoxes(nodes: readonly DeviceNode[], options: VisualOptions): DeviceBox[] {
  const masked = (options.mask ?? []).flatMap((mask) => {
    if (!("chain" in mask))
      throw new TypeError("toHaveScreenshot({ mask }) takes locators from the same screen")

    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a device locator's chain, checked by the `in` above
    return resolveChain(nodes, (mask as DeviceLocator).chain)
  })

  return [...nodes.filter((node) => node.password), ...masked].flatMap((node) =>
    node.box === undefined ? [] : [node.box],
  )
}

/** Compares `locator`'s element (the whole screen for `screen`) with its baseline, as one step. */
export function deviceScreenshot(
  locator: DeviceLocator,
  name: string | undefined,
  options: VisualOptions = {},
): Promise<void> {
  const { context } = locator
  const shots = context.shots

  if (shots === undefined)
    return Promise.reject(
      new DanwoError("CONFIG_INVALID", "this session keeps no screenshot baselines"),
    )

  const index = shots.next()
  const named = name ?? `screenshot-${index}`
  const whole = locator.chain.length === 0
  const subjectText = whole ? "screen" : locator.text

  const take = async (): Promise<Buffer> => {
    const dir = await mkdtemp(join(tmpdir(), "danwo-shot-"))

    try {
      const file = join(dir, "screen.png")
      const nodes = (await context.target.read()).nodes

      if (!(await context.target.screenshot(file))) throw new Error("no screenshot could be taken")

      const image = PNG.sync.read(await readFile(file))
      const hidden = hiddenBoxes(nodes, options)

      if (whole)
        return cut(
          image,
          { x: 0, y: STATUS_BAR, width: image.width, height: image.height - STATUS_BAR },
          hidden,
        )

      const matched = resolveChain(nodes, locator.chain)
      const [only] = matched

      if (matched.length !== 1 || only?.box === undefined)
        throw new Error(
          `${locator.text} matched ${matched.length} elements; it needs exactly one with a place on screen`,
        )

      return cut(image, only.box, hidden)
    } finally {
      await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    }
  }

  return context.steps.run(
    "assertion",
    "expect.toHaveScreenshot",
    `${subjectText} toHaveScreenshot(${JSON.stringify(named)})`,
    async () => {
      const compared = await compareScreenshot({
        subject: { text: subjectText, take },
        name: named,
        options,
        mask: [],
        settings: shots.settings,
        timeout: options.timeout ?? context.assertionTimeout,
        index,
      })

      shots.note({ kind: "screenshot", at: new Date().toISOString(), name: named, ...compared })

      if (compared.outcome === "differs")
        throw new ScreenshotMismatch(
          `expect(${subjectText}).toHaveScreenshot(${JSON.stringify(named)}) failed: ${compared.reason}`,
        )
    },
    { verifies: true },
  )
}
