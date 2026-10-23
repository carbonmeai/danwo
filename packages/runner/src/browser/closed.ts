/** A click on an element that closes its own page, as a "Close" button calling `window.close()`. */

/** The page of a clicked element, as far as telling whether it closed goes. */
interface ClosingPage {
  isClosed(): boolean
  waitForEvent(event: "close", options: { timeout: number }): Promise<unknown>
}

/** How long a page that the click is closing gets to say so, once the click has failed. */
const CLOSE_GRACE_MS = 1_000

/**
 * Whether a click failed only because the page it clicked closed itself. Playwright can report
 * such a click as failed while the page goes away; the click did its work, and the test or session
 * goes on in the tab left open. Any other failure is left to throw.
 */
async function closedByClick(page: ClosingPage, error: unknown): Promise<boolean> {
  if (!(error instanceof Error)) return false
  if (!/Target page, context or browser has been closed/.test(error.message)) return false
  if (page.isClosed()) return true

  return page.waitForEvent("close", { timeout: CLOSE_GRACE_MS }).then(
    () => true,
    () => false,
  )
}

/** Runs `click`, and counts it as done when it failed because it closed its own page. */
export async function clickClosing(page: ClosingPage, click: () => Promise<void>): Promise<void> {
  try {
    await click()
  } catch (error) {
    if (!(await closedByClick(page, error))) throw error
  }
}
