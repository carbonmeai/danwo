/** The screen when an attempt failed: where the page was, what it said, and what it looked like. */
import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"

import type { Page } from "playwright-core"

import type { MissingCause } from "./missing.ts"
import { takeScreenshot } from "./screenshots.ts"

export interface FailureEvidence {
  /** The page's URL, redacted. */
  readonly url?: string
  /** The page's text as an accessibility tree, redacted; a file relative to the artifacts directory. */
  readonly screen?: string
  /** A masked screenshot, relative to the artifacts directory. */
  readonly screenshot?: string
  /** For a locator that failed: the elements nearest to what it asked for, redacted. */
  readonly candidates?: readonly string[]
}

export interface EvidenceOptions {
  readonly page: Page
  readonly dir: string
  readonly redact: (text: string) => string
  readonly secrets: readonly string[]
  readonly timeout: number
  /** Told why the screenshot was not taken, when it was not. */
  readonly onMissed?: (cause: MissingCause, reason: string) => void
}

const SCREEN_FILE = "screen-at-failure.txt"
/** Relative to the record, with forward slashes as the record stores it on every platform. */
const SCREENSHOT_FILE = "screenshots/failure.png"

async function screenText(options: EvidenceOptions): Promise<string | undefined> {
  try {
    const title = await options.page.title()
    const tree = await options.page.ariaSnapshot({ timeout: options.timeout })
    const file = join(options.dir, SCREEN_FILE)

    await mkdir(options.dir, { recursive: true })
    await writeFile(file, options.redact(`${title}\n\n${tree}\n`))

    return SCREEN_FILE
  } catch {
    return undefined
  }
}

/** Captures what the page showed; best effort, never throws. */
export async function captureEvidence(options: EvidenceOptions): Promise<FailureEvidence> {
  const url = options.page.isClosed() ? undefined : options.redact(options.page.url())
  const screen = url === undefined ? undefined : await screenText(options)
  const screenshot =
    url === undefined
      ? undefined
      : await takeScreenshot({
          page: options.page,
          dir: options.dir,
          path: SCREENSHOT_FILE,
          secrets: options.secrets,
          timeout: options.timeout,
          ...(options.onMissed && { onMissed: options.onMissed }),
        })

  return {
    ...(url !== undefined && { url }),
    ...(screen !== undefined && { screen }),
    ...(screenshot !== undefined && { screenshot }),
  }
}
