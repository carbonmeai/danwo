/**
 * What a session's pages said between two tool calls: console errors and warnings, uncaught page
 * errors, requests that failed or answered with an error status, and dialogs (which are accepted
 * so the page can go on). Each call drains what happened since the previous one.
 */
import type { BrowserContext, Page } from "playwright-core"

/** At most this many events are kept between calls; the rest are counted. */
const MAX_EVENTS = 30

export class PageWatch {
  private events: string[] = []
  private dropped = 0
  private readonly redact: (text: string) => string

  constructor(redact: (text: string) => string) {
    this.redact = redact
  }

  /** Watches `context`'s pages, now and later; calls `onPage` for each page it opens. */
  attach(context: BrowserContext, onPage: (page: Page) => void): void {
    for (const page of context.pages()) this.watch(page)
    context.on("page", (page) => {
      this.watch(page)
      this.note("a new tab opened, and actions now go to it (tabs lists every tab)")
      onPage(page)
    })
  }

  /** What happened since the last drain, as lines; empty when nothing did. */
  drain(): string[] {
    const lines = this.dropped > 0 ? [...this.events, `… ${this.dropped} more`] : this.events

    this.events = []
    this.dropped = 0

    return lines
  }

  private note(line: string): void {
    if (this.events.length >= MAX_EVENTS) this.dropped += 1
    else this.events.push(this.redact(line))
  }

  private watch(page: Page): void {
    page.on("console", (message) => {
      if (message.type() === "error" || message.type() === "warning")
        this.note(`console ${message.type()}: ${message.text()}`)
    })
    page.on("pageerror", (error) => this.note(`page error: ${error.message}`))
    page.on("requestfailed", (request) =>
      this.note(
        `failed request: ${request.method()} ${request.url()} (${request.failure()?.errorText ?? "failed"})`,
      ),
    )
    page.on("response", (response) => {
      if (response.status() >= 400)
        this.note(`${response.request().method()} ${response.url()} → ${response.status()}`)
    })
    page.on("dialog", (dialog) => {
      this.note(`${dialog.type()} dialog ${JSON.stringify(dialog.message())} accepted`)
      void dialog.accept().catch(() => {})
    })
  }
}
