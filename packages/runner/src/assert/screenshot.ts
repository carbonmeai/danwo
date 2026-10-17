/**
 * `toHaveScreenshot`: the page or an element compared with a baseline image kept next to the test.
 * Animations are stopped and the caret hidden so the picture is steady, and masked areas (times,
 * avatars) are painted over in both images. A missing baseline is written on the first run and
 * the step notes it; `--update-snapshots` rewrites every baseline. A difference is kept as the
 * baseline, the new image and a diff that marks the pixels that changed, for the flight report.
 */
import { copyFile, mkdir, readFile, stat, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"

import pixelmatch from "pixelmatch"
import type { Locator as PlaywrightLocator } from "playwright-core"
import { PNG } from "pngjs"

/** Whether baselines are written: only when missing, every time, or never. */
export type BaselineUpdate = "missing" | "all" | "none"

/** Where a session keeps baselines and the images of a failed comparison. */
export interface ScreenshotSettings {
  /** The folder of this test's baselines. */
  readonly dir: string
  readonly update: BaselineUpdate
  /** The attempt's artifacts folder: failed comparisons are written under it. */
  readonly artifactsDir: string
}

/** How strict a comparison is, and what to leave out of it. */
export interface ScreenshotOptions {
  /** Share of pixels allowed to differ, from 0 (none, the default) to 1. */
  readonly maxDiffPixelRatio?: number
  /** How different one pixel's colour may be before it counts, from 0 to 1 (default 0.2). */
  readonly threshold?: number
  /** Animations stop before the picture is taken unless `"allow"` (default `"disabled"`). */
  readonly animations?: "disabled" | "allow"
  /** Milliseconds to keep trying for a match; the session's assertion timeout by default. */
  readonly timeout?: number
}

/** A picture to compare: how to take it, and how the test named its subject. */
export interface Subject {
  readonly text: string
  take(options: {
    readonly animations: "disabled" | "allow"
    readonly mask: readonly PlaywrightLocator[]
    readonly timeout: number
  }): Promise<Buffer>
}

/**
 * What a comparison did, for the step's record. The baseline of a match is its own path; the
 * images of a difference are copies under the artifacts folder, relative to it.
 */
export type Compared =
  | { readonly outcome: "matched" | "written"; readonly baseline: string }
  | {
      readonly outcome: "differs"
      readonly baseline: string
      readonly actual: string
      readonly diff?: string
      readonly reason: string
    }

/** A screenshot check in a step's record. */
export type ScreenshotEvent = {
  readonly kind: "screenshot"
  readonly at: string
  readonly name: string
} & Pick<Compared, "outcome" | "baseline"> & {
    readonly actual?: string
    readonly diff?: string
  }

/** The comparison did not match before its timeout. */
export class ScreenshotMismatch extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ScreenshotMismatch"
  }
}

const PAUSE_MS = 150

/** A file name for `name`: letters, digits, dashes and dots only. */
function screenshotFile(name: string): string {
  const safe = name
    .replaceAll(/[^\w.-]+/g, "-")
    .replaceAll(/^-+|-+$/g, "")
    .toLowerCase()

  return safe.endsWith(".png") ? safe : `${safe || "screenshot"}.png`
}

interface Difference {
  readonly pixels: number
  readonly ratio: number
  readonly diff?: Buffer
  /** Set when the images cannot be compared pixel by pixel. */
  readonly sizes?: string
}

/** How two PNG images differ. */
function difference(expected: Buffer, actual: Buffer, threshold: number): Difference {
  const left = PNG.sync.read(expected)
  const right = PNG.sync.read(actual)

  if (left.width !== right.width || left.height !== right.height)
    return {
      pixels: Number.POSITIVE_INFINITY,
      ratio: 1,
      sizes: `${left.width}x${left.height} expected, ${right.width}x${right.height} taken`,
    }

  const diff = new PNG({ width: left.width, height: left.height })
  const pixels = pixelmatch(left.data, right.data, diff.data, left.width, left.height, {
    threshold,
  })

  return { pixels, ratio: pixels / (left.width * left.height), diff: PNG.sync.write(diff) }
}

async function exists(path: string): Promise<boolean> {
  return stat(path).then(
    () => true,
    () => false,
  )
}

/** Takes pictures until two in a row are the same, so the page has stopped moving. */
async function steady(subject: Subject, take: Parameters<Subject["take"]>[0], deadline: number) {
  let last = await subject.take(take)

  while (Date.now() < deadline) {
    const next = await subject.take(take)

    if (next.equals(last)) return next
    last = next
  }

  return last
}

interface Comparison {
  readonly subject: Subject
  readonly name: string
  readonly options: ScreenshotOptions
  readonly mask: readonly PlaywrightLocator[]
  readonly settings: ScreenshotSettings
  readonly timeout: number
  /** A number unique within the attempt, for the files of a failed comparison. */
  readonly index: number
}

/** Writes the baseline from a steady picture. */
async function writeBaseline(
  baseline: string,
  comparison: Comparison,
  take: Parameters<Subject["take"]>[0],
) {
  const picture = await steady(comparison.subject, take, Date.now() + comparison.timeout)

  await mkdir(dirname(baseline), { recursive: true })
  await writeFile(baseline, picture)
}

/** Keeps the baseline, the picture and the diff under the artifacts folder. */
async function keepMismatch(
  comparison: Comparison,
  baseline: string,
  picture: Buffer,
  diff: Buffer | undefined,
): Promise<{ baseline: string; actual: string; diff?: string }> {
  const prefix = join("screenshots", `compare-${comparison.index}`)
  const dir = comparison.settings.artifactsDir

  await mkdir(join(dir, "screenshots"), { recursive: true })
  await copyFile(baseline, join(dir, `${prefix}-baseline.png`))
  await writeFile(join(dir, `${prefix}-actual.png`), picture)
  if (diff !== undefined) await writeFile(join(dir, `${prefix}-diff.png`), diff)

  return {
    baseline: `${prefix}-baseline.png`,
    actual: `${prefix}-actual.png`,
    ...(diff !== undefined && { diff: `${prefix}-diff.png` }),
  }
}

function within(found: Difference, options: ScreenshotOptions): boolean {
  return found.sizes === undefined && found.ratio <= (options.maxDiffPixelRatio ?? 0)
}

function reasonOf(found: Difference): string {
  if (found.sizes !== undefined) return `the size changed: ${found.sizes}`

  return `${found.pixels} pixels (${(found.ratio * 100).toFixed(2)}%) differ`
}

/** Compares until the picture matches the baseline or time runs out; throws ScreenshotMismatch. */
export async function compareScreenshot(comparison: Comparison): Promise<Compared> {
  const { settings, options, subject, name } = comparison
  const baseline = join(settings.dir, screenshotFile(name))
  const take = {
    animations: options.animations ?? "disabled",
    mask: comparison.mask,
    timeout: comparison.timeout,
  }

  if (settings.update === "all" || (!(await exists(baseline)) && settings.update === "missing")) {
    await writeBaseline(baseline, comparison, take)

    return { outcome: "written", baseline }
  }

  if (!(await exists(baseline)))
    throw new ScreenshotMismatch(`no baseline for ${subject.text} at ${baseline}`)

  const expected = await readFile(baseline)
  const deadline = Date.now() + comparison.timeout

  for (;;) {
    const picture = await subject.take(take)
    const found = difference(expected, picture, options.threshold ?? 0.2)

    if (within(found, options)) return { outcome: "matched", baseline }

    if (Date.now() >= deadline) {
      const kept = await keepMismatch(comparison, baseline, picture, found.diff)

      return { outcome: "differs", ...kept, reason: reasonOf(found) }
    }

    await new Promise((resolve) => setTimeout(resolve, PAUSE_MS))
  }
}
