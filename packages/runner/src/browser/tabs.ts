/**
 * The tabs of one attempt and the dialogs they open. A page the app opens (a popup, a link with
 * `target="_blank"`) becomes the active tab, the way a person's attention follows it; locators,
 * the agent and screenshots all work on the active tab.
 *
 * A dialog (alert, confirm, prompt) blocks its page: nothing can be read or clicked until it is
 * answered. While the agent acts, dialogs are held open so it can read and answer them; at any
 * other time they are dismissed at once, as a browser with no one to answer would.
 */
import type { BrowserContext, Dialog, Page } from "playwright-core"

/** A dialog waiting for an answer. */
export interface OpenDialog {
  readonly type: string
  readonly message: string
  readonly defaultValue: string
  readonly dialog: Dialog
}

export class Tabs {
  private readonly open: Page[] = []
  private active: Page
  private holding = 0
  private pending: OpenDialog | undefined
  /** The action the open dialog interrupted; it finishes once the dialog is answered. */
  private interrupted: Promise<unknown> | undefined
  private dialogWaiters: ((dialog: OpenDialog) => void)[] = []
  private tabWaiters: ((page: Page) => void)[] = []
  private readonly watchers: ((page: Page) => void)[] = []

  constructor(context: BrowserContext, first: Page) {
    this.active = first
    this.add(first)
    context.on("page", (page) => {
      this.add(page)
      this.active = page
      for (const resolve of this.tabWaiters.splice(0)) resolve(page)
    })
  }

  /** The tab actions and reads go to. */
  get page(): Page {
    return this.active
  }

  /** Every open tab, oldest first. */
  list(): readonly Page[] {
    return this.open.filter((page) => !page.isClosed())
  }

  /** Makes tab `index` (as `list()` numbers them) the active one. */
  switchTo(index: number): void {
    const page = this.list()[index]

    if (page === undefined) throw new Error(`there is no tab ${index}`)
    this.active = page
  }

  /** Runs `watch` on every tab, open now or later, e.g. to record its console. */
  onEveryPage(watch: (page: Page) => void): void {
    this.watchers.push(watch)
    for (const page of this.list()) watch(page)
  }

  /** The dialog waiting for an answer, if one is open. */
  get dialog(): OpenDialog | undefined {
    return this.pending
  }

  /** Resolves when a dialog opens (at once if one is open). */
  dialogOpened(): Promise<OpenDialog> {
    if (this.pending !== undefined) return Promise.resolve(this.pending)

    return new Promise((resolve) => this.dialogWaiters.push(resolve))
  }

  /** Resolves with the next tab that opens. */
  tabOpened(): Promise<Page> {
    return new Promise((resolve) => this.tabWaiters.push(resolve))
  }

  /** Answers the open dialog; `text` fills a prompt. */
  async answer(accept: boolean, text?: string): Promise<void> {
    const open = this.pending

    if (open === undefined) throw new Error("no dialog is open")

    this.pending = undefined
    if (accept) await open.dialog.accept(text)
    else await open.dialog.dismiss()

    const interrupted = this.interrupted

    this.interrupted = undefined
    await interrupted?.catch(() => undefined)
  }

  /**
   * Runs `action` with dialogs held. Resolves with the dialog if one opens before the action ends
   * (the action then finishes once the dialog is answered), or with undefined once it ends.
   */
  async runAction(action: () => Promise<unknown>): Promise<OpenDialog | undefined> {
    const running = action()
    const opened = this.dialogOpened().then((dialog) => ({ dialog }))
    const outcome = await Promise.race([running.then(() => ({ dialog: undefined })), opened])

    if (outcome.dialog !== undefined) this.interrupted = running

    return outcome.dialog
  }

  /** Holds dialogs open for an answer while `body` runs; nested holds are fine. */
  async holdingDialogs<T>(body: () => Promise<T>): Promise<T> {
    this.holding++

    try {
      return await body()
    } finally {
      this.holding--
      if (this.holding === 0 && this.pending !== undefined)
        await this.answer(false).catch(() => undefined)
    }
  }

  private add(page: Page): void {
    this.open.push(page)
    page.on("dialog", (dialog) => void this.onDialog(dialog))
    page.on("close", () => {
      if (this.active === page) this.active = this.list().at(-1) ?? page
    })
    for (const watch of this.watchers) watch(page)
  }

  private async onDialog(dialog: Dialog): Promise<void> {
    if (this.holding === 0) {
      await dialog.dismiss().catch(() => undefined)

      return
    }

    const open = {
      type: dialog.type(),
      message: dialog.message(),
      defaultValue: dialog.defaultValue(),
      dialog,
    }

    this.pending = open
    for (const resolve of this.dialogWaiters.splice(0)) resolve(open)
  }
}
