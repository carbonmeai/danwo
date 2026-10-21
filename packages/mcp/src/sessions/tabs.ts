/**
 * A session's tabs: every page its browser has open, and the one actions go to. A tab the app
 * opens (a popup, a link with `target="_blank"`) becomes the active one, the way a person's
 * attention follows it; when the active tab closes, the newest one left takes over. Tabs are
 * numbered from 1 in the order they opened, counting only those still open.
 */
import type { BrowserContext, CDPSession, Page } from "playwright-core"

/** A browser session that counts the context's pages as the browser has them. */
interface TargetProbe {
  readonly context: BrowserContext
  readonly session: CDPSession
  readonly contextId: string | undefined
}

export class SessionTabs {
  private readonly pages: Page[] = []
  private active: Page
  private probe: TargetProbe | undefined

  constructor(first: Page) {
    this.active = first
    this.add(first)
  }

  /** The tab actions and reads go to. */
  get page(): Page {
    return this.active
  }

  /** Every open tab, oldest first. */
  list(): Page[] {
    return this.pages.filter((page) => !page.isClosed())
  }

  /** The number `page` has among the open tabs, from 1. */
  numberOf(page: Page): number {
    return this.list().indexOf(page) + 1
  }

  /** A page the browser opened: it becomes the active tab. */
  opened(page: Page): void {
    this.add(page)
    this.active = page
  }

  /** Makes tab `number` the active one. */
  async switchTo(number: number): Promise<void> {
    const page = this.find(number)

    this.active = page
    await page.bringToFront()
  }

  /** Closes tab `number`, or the active one; refuses to close the session's only tab. */
  async close(number?: number): Promise<number> {
    const page = number === undefined ? this.active : this.find(number)
    const shown = this.numberOf(page)

    if (this.list().length === 1)
      throw new Error("it is the session's only tab: close the session with close_session")

    await page.close()

    return shown
  }

  /**
   * Waits, up to `timeout`, for the tabs the browser has opened in `context` but not yet handed
   * over: a popup exists in the browser a moment before its page does.
   */
  async caughtUp(context: BrowserContext, timeout: number): Promise<void> {
    const opened = await this.browserTabs(context)

    if (opened === undefined || opened <= this.list().length) return

    await context.waitForEvent("page", { timeout }).catch(() => undefined)
  }

  /** How many tabs the browser has in `context`; undefined when it cannot say. */
  private async browserTabs(context: BrowserContext): Promise<number | undefined> {
    try {
      const probe = await this.probeOf(context)
      const { targetInfos } = await probe.session.send("Target.getTargets")

      return targetInfos.filter(
        (target) => target.type === "page" && target.browserContextId === probe.contextId,
      ).length
    } catch {
      this.probe = undefined

      return undefined
    }
  }

  private async probeOf(context: BrowserContext): Promise<TargetProbe> {
    if (this.probe?.context === context) return this.probe

    const session = await context.newCDPSession(this.active)
    const { targetInfo } = await session.send("Target.getTargetInfo")

    this.probe = { context, session, contextId: targetInfo.browserContextId }

    return this.probe
  }

  /** The `tabs` answer: one line per tab, the active one marked. */
  async lines(redact: (text: string) => string): Promise<string[]> {
    const lines = await Promise.all(
      this.list().map(async (page, index) => {
        const title = await page.title().catch(() => "")
        const mark = page === this.active ? "* " : "  "

        return `${mark}${index + 1}. ${redact(title === "" ? "(no title)" : title)} ${redact(page.url())}`
      }),
    )

    return [...lines, "* is the tab actions go to; switch_tab changes it, close_tab closes one"]
  }

  private find(number: number): Page {
    const open = this.list()
    const page = open[number - 1]

    if (page === undefined)
      throw new Error(
        `there is no tab ${number}: ${open.length === 1 ? "1 tab is" : `${open.length} tabs are`} open`,
      )

    return page
  }

  private add(page: Page): void {
    if (this.pages.includes(page)) return

    this.pages.push(page)
    page.once("close", () => {
      if (this.active === page) this.active = this.list().at(-1) ?? page
    })
  }
}
