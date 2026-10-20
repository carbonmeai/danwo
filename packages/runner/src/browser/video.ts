/**
 * Video of a browser attempt: each tab is filmed from the moment it opens until it or the context
 * closes, then saved as `video/tab-<n>.webm` in the attempt's directory. Fields holding a secret
 * show their characters as dots on screen, so the film never shows a typed secret.
 */
import { rm } from "node:fs/promises"
import { join } from "node:path"

import type { BrowserContext, BrowserContextOptions, Page } from "playwright-core"

import { type CapturedVideo, VIDEO_DIR, VIDEO_SIZE } from "../record/video.ts"
import { SECRET_FIELD } from "../secrets/fields.ts"

/**
 * Where the browser writes video while it films, before each tab's file is named; each extra
 * person's browser films into its own, so saving one context's tabs leaves the others' alone.
 */
function rawDir(user: string | undefined): string {
  return join(VIDEO_DIR, user === undefined ? "raw" : `raw-${user}`)
}

/** The context options that film every tab into the attempt's directory. */
export function videoContextOptions(artifactsDir: string, user?: string): BrowserContextOptions {
  return { recordVideo: { dir: join(artifactsDir, rawDir(user)), size: VIDEO_SIZE } }
}

/** Shows a secret field's characters as dots, in every page the context opens. */
export async function hideSecretText(context: BrowserContext): Promise<void> {
  await context.addInitScript((attribute) => {
    const sheet = new CSSStyleSheet()

    sheet.replaceSync(`[${attribute}] { -webkit-text-security: disc !important; }`)
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet]
  }, SECRET_FIELD)
}

interface Filmed {
  readonly page: Page
  readonly startedAt: number
  closedAt?: number
  /** The tab that opened this one, for a popup. */
  opener?: number
  /** The host of the first web page it showed. */
  host?: string | undefined
}

/** The host of `url`, for a web page; undefined for `about:blank` and the like. */
export function webHost(url: string): string | undefined {
  try {
    const { protocol, host } = new URL(url)

    return protocol === "http:" || protocol === "https:" ? host : undefined
  } catch {
    return undefined
  }
}

/** Who opened a filmed tab, the host it showed, and whether it closed before `closedAt`. */
function tabOrigin(
  entry: Filmed,
  closedAt: number,
): Pick<CapturedVideo, "opener" | "host" | "closed"> {
  return {
    ...(entry.opener !== undefined && { opener: entry.opener }),
    ...(entry.host !== undefined && { host: entry.host }),
    ...(entry.closedAt !== undefined && entry.closedAt < closedAt && { closed: true }),
  }
}

/** The tabs being filmed, in the order they opened. */
export class TabFilm {
  private readonly filmed: Filmed[] = []
  private saved: CapturedVideo[] = []
  private readonly artifactsDir: string
  /** The person whose browser this films, for a test that opened more than one person's. */
  private readonly user: string | undefined

  constructor(artifactsDir: string, user?: string) {
    this.artifactsDir = artifactsDir
    this.user = user
  }

  /** Starts keeping `page`'s video, filmed from `startedAt` (when the tab opened). */
  watch(page: Page, startedAt = Date.now()): void {
    if (this.filmed.some((entry) => entry.page === page)) return

    const entry: Filmed = { page, startedAt }

    this.filmed.push(entry)
    page.once("close", () => {
      entry.closedAt = Date.now()
    })
    entry.host = webHost(page.url())
    page.on("framenavigated", (frame) => {
      if (entry.host === undefined && frame === page.mainFrame()) entry.host = webHost(frame.url())
    })
    void page
      .opener()
      .then((opener) => {
        const at = this.filmed.findIndex((each) => each.page === opener)

        if (at >= 0) entry.opener = at + 1
      })
      .catch(() => undefined)
  }

  /**
   * Names each tab's file once the context has closed (it began closing at `closedAt`; a tab that
   * closed before then is marked closed), and drops the browser's own copies. Never throws: a
   * video that could not be saved is left out.
   */
  async save(closedAt: number): Promise<void> {
    const saved: CapturedVideo[] = []

    for (const [at, entry] of this.filmed.entries()) {
      const video = entry.page.video()

      if (video === null) continue

      const name = this.user === undefined ? `tab-${at + 1}` : `${this.user}-tab-${at + 1}`
      const file = join(VIDEO_DIR, `${name}.webm`)

      try {
        await video.saveAs(join(this.artifactsDir, file))
        saved.push({
          file: file.split("\\").join("/"),
          startedAt: new Date(entry.startedAt).toISOString(),
          durationMs: Math.max((entry.closedAt ?? closedAt) - entry.startedAt, 0),
          tab: at + 1,
          ...(this.user !== undefined && { user: this.user }),
          ...tabOrigin(entry, closedAt),
        })
      } catch {
        /* The tab never painted a frame, or its file is gone: there is nothing to show. */
      }
    }

    await rm(join(this.artifactsDir, rawDir(this.user)), { recursive: true, force: true })
    this.saved = saved
  }

  /** The saved videos, after `save`. */
  videos(): readonly CapturedVideo[] {
    return this.saved
  }
}
