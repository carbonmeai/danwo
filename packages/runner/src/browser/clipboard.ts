/**
 * `app.clipboard()`: the text a page copied, read the way the page itself would read it. Chromium
 * lets a page read the clipboard once the context has the `clipboard-read` permission (and copy to
 * it with `clipboard-write`), which `browser.contextOptions.permissions` grants. Firefox and WebKit
 * ask the person to paste instead, which a test cannot answer, so there it is a config error.
 */
import type { Page } from "playwright-core"

import { DanwoError } from "../support/codes.ts"

/** The config that lets a page read and write the clipboard, for the errors. */
const GRANT =
  'browser: { contextOptions: { permissions: ["clipboard-read", "clipboard-write"] } } in the config'

/** The clipboard's text, as the active tab reads it. */
export async function readClipboard(page: Page): Promise<string> {
  const engine = page.context().browser()?.browserType().name() ?? "chromium"

  if (engine !== "chromium")
    throw new DanwoError(
      "CONFIG_INVALID",
      `app.clipboard() reads the clipboard in Chromium only; ${engine} asks the person to paste`,
    )

  try {
    return await page.evaluate(() => navigator.clipboard.readText())
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)

    if (!/NotAllowedError|permission/i.test(message)) throw error

    throw new DanwoError(
      "CONFIG_INVALID",
      `the page may not read the clipboard: grant it with ${GRANT}`,
      { cause: error },
    )
  }
}
