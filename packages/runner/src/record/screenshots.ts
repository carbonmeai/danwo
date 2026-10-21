/**
 * Screenshots that never show a secret: fields holding a secret's value are masked, and a page
 * whose text shows one is not captured at all. Taking one never changes the page: an app still
 * hydrating would report a changed attribute or style as a mismatch.
 */
import { mkdir } from "node:fs/promises"
import { dirname, join } from "node:path"

import type { Locator, Page } from "playwright-core"

import { valueSelector } from "../locate/display-value.ts"
import { SECRET_FIELD } from "../secrets/fields.ts"

/** Answers whether the page's text shows a secret. Runs in the page and changes nothing there. */
function showsSecret(values: readonly string[]): boolean {
  const text = document.body.innerText

  return values.some((value) => text.includes(value))
}

/** A regular expression that finds `value` anywhere in a field's value. */
function containing(value: string): RegExp {
  return new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
}

/**
 * What a screenshot paints over: password fields, fields a secret was typed into, and any field
 * whose current value holds a secret. Each is a locator, so nothing is written into the page.
 */
function masks(page: Page, secrets: readonly string[]): Locator[] {
  return [
    page.locator(`[${SECRET_FIELD}], input[type=password]`),
    ...secrets.map((value) => page.locator(valueSelector(containing(value)))),
  ]
}

export interface ShotOptions {
  readonly page: Page
  /** The attempt's artifacts directory; `path` is relative to it. */
  readonly dir: string
  readonly path: string
  /** Every secret value revealed so far. */
  readonly secrets: readonly string[]
  readonly timeout: number
  /** Told when the page's text showed a secret, so no screenshot was taken. */
  readonly onSecretShown?: () => void
}

/** Takes a masked screenshot to `dir/path`; resolves with `path`, or undefined when not taken. */
export async function takeScreenshot(options: ShotOptions): Promise<string | undefined> {
  const { page } = options

  try {
    if (options.secrets.length > 0) {
      const shown = await page.evaluate(showsSecret, [...options.secrets])

      if (shown) {
        options.onSecretShown?.()

        return undefined
      }
    }

    const file = join(options.dir, options.path)

    await mkdir(dirname(file), { recursive: true })
    /* Hiding the caret would write an inline style on every field, so the caret stays as it is. */
    await page.screenshot({
      path: file,
      timeout: options.timeout,
      caret: "initial",
      mask: masks(page, options.secrets),
    })

    return options.path
  } catch {
    return undefined
  }
}
