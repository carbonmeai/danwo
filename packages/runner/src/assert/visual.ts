/**
 * The `toHaveScreenshot` check of an element or of the whole page, recorded as a step that
 * verifies. The step notes whether the baseline matched or was written, and keeps the images of a
 * difference for the flight report.
 */
import type { LocateContext } from "../locate/locator.ts"
import { ElementLocator } from "../locate/locator.ts"
import type { Locator } from "../locate/types.ts"
import {
  compareScreenshot,
  ScreenshotMismatch,
  type ScreenshotOptions,
  type Subject,
} from "./screenshot.ts"

/** Options of `toHaveScreenshot`: how strict, and which elements to paint over. */
export interface VisualOptions extends ScreenshotOptions {
  /** Elements whose content changes from run to run (times, avatars), painted over in both. */
  readonly mask?: readonly Locator[]
}

function maskOf(options: VisualOptions) {
  return (options.mask ?? []).map((locator) => {
    if (!(locator instanceof ElementLocator))
      throw new TypeError("toHaveScreenshot({ mask }) takes locators from the same screen")

    return locator.resolve()
  })
}

/** Compares `subject` with its baseline as one step; throws ScreenshotMismatch on a difference. */
export function screenshotCheck(
  context: LocateContext,
  subject: Subject,
  name: string | undefined,
  options: VisualOptions = {},
): Promise<void> {
  const index = context.shots.next()
  const named = name ?? `screenshot-${index}`
  const label = `${subject.text} toHaveScreenshot(${JSON.stringify(named)})`

  return context.steps.run(
    "assertion",
    "expect.toHaveScreenshot",
    label,
    async () => {
      const compared = await compareScreenshot({
        subject,
        name: named,
        options,
        mask: maskOf(options),
        settings: context.shots.settings,
        timeout: options.timeout ?? context.assertionTimeout,
        index,
      })

      context.shots.note({
        kind: "screenshot",
        at: new Date().toISOString(),
        name: named,
        ...compared,
      })

      if (compared.outcome === "differs")
        throw new ScreenshotMismatch(
          `expect(${subject.text}).toHaveScreenshot(${JSON.stringify(named)}) failed: ${compared.reason}`,
        )
    },
    { verifies: true },
  )
}
