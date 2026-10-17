/**
 * Waiting, after each action, until there is nothing left to wait for. On the page: no navigation
 * still loading, and the DOM unchanged for a short while. Behind the page, when the session has an
 * environment: no provider call the app made still open at the proxy, and no webhook delivery in
 * flight (and, with `settle`, background work such as webhooks on a manual clock played out). A
 * step that clicks "Pay" then goes on only once the app has heard back from Stripe, so tests need
 * no sleeps. Each wait is capped, and how long it took is recorded on the step.
 */
import type { Page } from "playwright-core"

/** What is waited for after an action: the page, the page and the backend, or nothing. */
export type ReadinessMode = "page" | "page+backend" | "off"

/** What the environment says about the backend. */
export interface Backend {
  /** Resolves once nothing the app started is still in flight, or `timeoutMs` passed. */
  quiet(timeoutMs: number): Promise<void>
  /** Provider calls that failed (5xx or no answer), oldest first, each as one line. */
  failures?(): readonly string[]
}

export interface ReadinessOptions {
  readonly mode: ReadinessMode
  /** How the backend is waited on; without it `page+backend` waits on the page only. */
  readonly backend?: Backend | undefined
  /** The longest one wait lasts, in milliseconds. Default 5000. */
  readonly capMs?: number
  /** How long the DOM must stay unchanged to count as settled, in milliseconds. Default 100. */
  readonly quietMs?: number
}

export interface ReadyWait {
  readonly ms: number
  readonly waited: "page" | "page+backend"
}

const DEFAULT_CAP_MS = 5_000
const DEFAULT_QUIET_MS = 100
/** A page that never stops changing (a clock, an animation) is not waited on longer than this. */
const DOM_CAP_MS = 1_000

/** Resolves once `page`'s DOM has not changed for `quietMs`, or after `capMs`. */
function domQuiet(page: Page, quietMs: number, capMs: number): Promise<void> {
  return page
    .evaluate(
      ([quiet, cap]) =>
        new Promise<void>((resolve) => {
          let timer = setTimeout(done, quiet)
          const giveUp = setTimeout(done, cap)
          const observer = new MutationObserver(() => {
            clearTimeout(timer)
            timer = setTimeout(done, quiet)
          })

          function done() {
            observer.disconnect()
            clearTimeout(timer)
            clearTimeout(giveUp)
            resolve()
          }

          observer.observe(document, { subtree: true, childList: true, attributes: true })
        }),
      [quietMs, capMs] as const,
    )
    .catch(() => undefined)
}

/** The page loaded what an action started and stopped changing. */
async function pageSettled(page: Page, quietMs: number, capMs: number): Promise<void> {
  await page.waitForLoadState("domcontentloaded", { timeout: capMs }).catch(() => undefined)
  await domQuiet(page, quietMs, Math.min(capMs, DOM_CAP_MS))
}

/** How long is left of a wait that started at `started` and lasts at most `capMs`. */
function remaining(started: number, capMs: number): number {
  return Math.max(0, capMs - (performance.now() - started))
}

/** The session's waiting after actions. */
export class Readiness {
  private readonly options: ReadinessOptions

  constructor(options: ReadinessOptions) {
    this.options = options
  }

  /** Waits for `page` (and the backend) to go quiet; undefined when readiness is off. */
  async after(page: Page): Promise<ReadyWait | undefined> {
    const { mode, backend } = this.options

    if (mode === "off") return undefined

    const cap = this.options.capMs ?? DEFAULT_CAP_MS
    const quiet = this.options.quietMs ?? DEFAULT_QUIET_MS
    const started = performance.now()
    const withBackend = mode === "page+backend" && backend !== undefined

    await pageSettled(page, quiet, cap)

    if (withBackend) {
      await backend.quiet(remaining(started, cap)).catch(() => undefined)
      /* What the backend answered may change the page again. */
      await domQuiet(page, quiet, Math.min(remaining(started, cap), DOM_CAP_MS))
    }

    return {
      ms: Math.round(performance.now() - started),
      waited: withBackend ? "page+backend" : "page",
    }
  }
}
