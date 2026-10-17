/**
 * Screenshots that never show a secret: fields holding a secret's value are masked, and a page
 * whose text shows one is not captured at all.
 */
import { mkdir } from "node:fs/promises"
import { dirname, join } from "node:path"

import type { Page } from "playwright-core"

const MASKED = "data-danwo-secret"

/** Marks fields whose value holds a secret; answers whether the page's text shows one. */
function markSecrets(values: readonly string[]): boolean {
  const fields = document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
    "input, textarea",
  )

  for (const field of fields) {
    if (values.some((value) => field.value.includes(value)))
      field.setAttribute("data-danwo-secret", "")
  }

  return values.some((value) => document.body.innerText.includes(value))
}

export interface ShotOptions {
  readonly page: Page
  /** The attempt's artifacts directory; `path` is relative to it. */
  readonly dir: string
  readonly path: string
  /** Every secret value revealed so far. */
  readonly secrets: readonly string[]
  readonly timeout: number
}

/** Takes a masked screenshot to `dir/path`; resolves with `path`, or undefined when not taken. */
export async function takeScreenshot(options: ShotOptions): Promise<string | undefined> {
  const { page } = options

  try {
    if (options.secrets.length > 0) {
      const shown = await page.evaluate(markSecrets, [...options.secrets])

      if (shown) return undefined
    }

    const file = join(options.dir, options.path)

    await mkdir(dirname(file), { recursive: true })
    await page.screenshot({
      path: file,
      timeout: options.timeout,
      mask: [page.locator(`[${MASKED}], input[type=password]`)],
    })

    return options.path
  } catch {
    return undefined
  }
}
