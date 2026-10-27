/**
 * Page loads that the machine's network changing under them broke, loaded again. Chromium fails
 * every request still connecting (DNS, a TCP connect, a proxy's CONNECT tunnel) with
 * `net::ERR_NETWORK_CHANGED` when a network interface comes or goes, as one does each time Docker
 * starts a container. A suite that starts its services in containers while a test runs would
 * otherwise see a page that never loaded: Chromium's error page, and the next step failing on it.
 *
 * A main-frame navigation that failed so is loaded again, at most `RETRIES` times, and the app log
 * says so. Only a GET is: a form's POST is never sent twice, as the app may already have acted on
 * it. A POST answered with a redirect is followed by a GET, so the page after a form still loads.
 * Chromium offers no command-line switch or feature that keeps it from failing requests on a
 * network change, so the loads are made again rather than kept from failing.
 */
import type { Page, Request, Response } from "playwright-core"

const NETWORK_CHANGED = "net::ERR_NETWORK_CHANGED"

/** How many times a navigation is loaded again after it failed. */
const RETRIES = 2

/** How long a navigation loaded again may take. */
const LOAD_MS = 30_000

/** Tells the run's record what happened, as an app log line. */
type Note = (level: "warn" | "error", text: string) => void

interface Watch {
  readonly note: Note
  /** The failure reasons that count as the network changing; only `NETWORK_CHANGED` outside tests. */
  readonly reasons: readonly string[]
  /** How many of danwo's own navigations are under way; each loads itself again when it fails. */
  own: number
  /** The navigation being loaded again, which the next step waits for. */
  pending: Promise<void> | undefined
  /**
   * The last main-frame navigation that failed, and why: `page.goto` can reject saying only that
   * Chromium's error page interrupted it, so its reason is read from here.
   */
  failed: { readonly url: string; readonly reason: string } | undefined
}

const watched = new WeakMap<Page, Watch>()

/** The page Chromium shows in place of one it could not load. */
const ERROR_PAGE = "chrome-error://"

/** How long the failure of a navigation the error page interrupted takes to be heard, at most. */
const FAILURE_HEARD_MS = 2_000

/**
 * Why a navigation of `page` to `url` failed: the error's own `net::ERR_…`, else the failure the
 * page heard. When Chromium's error page interrupted the navigation, that failure may still be on
 * its way, so it is waited for.
 */
async function reasonOf(
  error: unknown,
  page: Page,
  url: string,
  watch: Watch,
): Promise<string | undefined> {
  const message = error instanceof Error ? error.message : String(error)
  const own = /net::ERR_[A-Z_]+/.exec(message)?.[0]

  if (own !== undefined) return own
  if (watch.failed?.url === url) return watch.failed.reason
  if (!message.includes(ERROR_PAGE)) return undefined

  const heard = await page
    .waitForEvent("requestfailed", {
      predicate: (request) => request.url() === url,
      timeout: FAILURE_HEARD_MS,
    })
    .catch(() => undefined)

  return heard?.failure()?.errorText
}

/**
 * Resolves once Chromium has shown its error page for the navigation that failed. It commits that
 * page a moment after the failure is reported, and a navigation started before it would be cut off
 * by it.
 */
async function errorPageShown(page: Page): Promise<void> {
  if (page.url().startsWith(ERROR_PAGE)) return

  await page
    .waitForEvent("framenavigated", {
      predicate: (frame) => frame === page.mainFrame() && frame.url().startsWith(ERROR_PAGE),
      timeout: FAILURE_HEARD_MS,
    })
    .catch(() => undefined)
}

/**
 * Goes to `url` on `page` as `page.goto` does, loading it again when the network changed under it.
 * danwo's own navigations (`app.open`, an agent's or a replay's) go this way.
 */
export async function gotoSurvivingNetworkChange(
  page: Page,
  url: string,
  options: { readonly timeout?: number } = {},
  tried = 0,
): Promise<Response | null> {
  const watch = watched.get(page)

  if (watch === undefined) return page.goto(url, options)

  for (let attempt = tried; ; attempt++) {
    if (attempt > 0) await errorPageShown(page)

    watch.own += 1
    watch.failed = undefined

    try {
      return await page.goto(url, options)
    } catch (error) {
      await goAgainOrThrow(error, { page, url, watch, attempt })
    } finally {
      watch.own -= 1
    }
  }
}

/** Notes that a failed navigation is loaded again, or rethrows its `error` when it is not. */
async function goAgainOrThrow(
  error: unknown,
  failed: {
    readonly page: Page
    readonly url: string
    readonly watch: Watch
    readonly attempt: number
  },
): Promise<void> {
  const { page, url, watch, attempt } = failed
  const reason = await reasonOf(error, page, url, watch)

  if (reason === undefined || !watch.reasons.includes(reason)) throw error

  if (attempt >= RETRIES) {
    watch.note("error", `${url} still could not be loaded after ${RETRIES} tries: ${reason}`)
    throw error
  }

  watch.note("warn", loadingAgain(url, reason, attempt + 1))
}

function loadingAgain(url: string, reason: string, attempt: number): string {
  return `${url}: the machine's network changed while it loaded (${reason}); loading it again (${attempt} of ${RETRIES})`
}

/** What to do about a main-frame navigation of `page` that failed: nothing, or load it again. */
function onFailed(page: Page, watch: Watch, request: Request): void {
  const reason = request.failure()?.errorText

  if (!request.isNavigationRequest() || request.frame() !== page.mainFrame()) return
  if (reason === undefined) return

  const url = request.url()

  watch.failed = { url, reason }
  if (!watch.reasons.includes(reason) || watch.own > 0) return

  if (request.method() !== "GET") {
    watch.note(
      "error",
      `${url}: the machine's network changed while it loaded (${reason}); not sent again, as a ${request.method()} is never sent twice`,
    )

    return
  }

  watch.note("warn", loadingAgain(url, reason, 1))
  watch.pending = (watch.pending ?? Promise.resolve())
    .then(() => gotoSurvivingNetworkChange(page, url, { timeout: LOAD_MS }, 1))
    .then(
      () => undefined,
      () => undefined,
    )
}

/**
 * Loads `page`'s main-frame navigations again when the network changed under them, telling
 * `note`. `reasons` is for tests, which cannot change the machine's network on every platform.
 */
export function surviveNetworkChanges(
  page: Page,
  note: Note,
  reasons: readonly string[] = [NETWORK_CHANGED],
): void {
  const watch: Watch = { note, reasons, own: 0, pending: undefined, failed: undefined }

  watched.set(page, watch)
  page.on("requestfailed", (request) => onFailed(page, watch, request))
}

/** Resolves once no navigation of `page` is being loaded again. */
export async function networkSettled(page: Page): Promise<void> {
  const watch = watched.get(page)

  for (let pending = watch?.pending; pending !== undefined; pending = watch?.pending) {
    await pending
    if (watch !== undefined && watch.pending === pending) watch.pending = undefined
  }
}
