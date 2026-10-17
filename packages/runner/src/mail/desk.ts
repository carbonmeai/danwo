/**
 * A session's view of the mail the app sent: values read from it, remembered with where they came
 * from, so that typing one is recorded as "the code in the newest mail to this address" and never
 * as the code itself, and so recordings can tell values that change every run from fixed text.
 */
import type { Page } from "playwright-core"

import {
  latestMail,
  mailPage,
  type MailMessage,
  type MailPick,
  pickFrom,
  type MailSource,
} from "./index.ts"

/** How often the mail sources are looked at again while a mail is awaited. */
const MAIL_POLL_MS = 100

/** Where a value came from: which address's newest mail, and what was taken from it. */
export interface MailOrigin {
  readonly to: string
  readonly pick: MailPick
}

export class MailDesk {
  private readonly sources: readonly MailSource[]
  /** Values read so far, each with where it came from; the newest last. */
  private readonly read: (readonly [value: string, origin: MailOrigin])[] = []

  constructor(sources: readonly MailSource[]) {
    this.sources = sources
  }

  /** Whether the session can read any mail. */
  get available(): boolean {
    return this.sources.length > 0
  }

  latest(to: string): MailMessage | undefined {
    return latestMail(this.sources, to)
  }

  /**
   * The value `pick` takes from the newest mail to `to`, remembered with its origin. Mail the app
   * is still sending is waited for, up to `timeout`.
   */
  async value(to: string, pick: MailPick, timeout: number): Promise<string | undefined> {
    const deadline = performance.now() + timeout

    for (;;) {
      const message = this.latest(to)
      const found = message === undefined ? undefined : pickFrom(message, pick)

      if (found !== undefined) {
        this.read.push([found, { to, pick }])

        return found
      }

      if (performance.now() >= deadline) return undefined

      await new Promise((resolve) => setTimeout(resolve, MAIL_POLL_MS))
    }
  }

  /** Where `text` came from, when it is a value read from mail in this session. */
  originOf(text: string): MailOrigin | undefined {
    return this.read.findLast(([value]) => value === text)?.[1]
  }

  /** Every value read from mail so far; recordings must not contain them. */
  values(): readonly string[] {
    return this.read.map(([value]) => value)
  }

  /** Shows the newest mail to `to` on `page`, waiting up to `timeout` for one; false when none came. */
  async open(page: Page, to: string, timeout: number): Promise<boolean> {
    const deadline = performance.now() + timeout
    let message = this.latest(to)

    while (message === undefined && performance.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, MAIL_POLL_MS))
      message = this.latest(to)
    }

    if (message === undefined) return false

    await page.setContent(mailPage(message), { timeout })

    return true
  }
}
