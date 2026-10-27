/** The app's side of an attempt: what it wrote to the console, page errors, and where it went. */
import type { ConsoleMessage, Page } from "playwright-core"

import type { AppLogRecord, StepRecorder } from "./steps.ts"

/** The current time, as step and log lines record it. */
function now(): string {
  return new Date().toISOString()
}

function levelOf(message: ConsoleMessage): AppLogRecord["level"] {
  switch (message.type()) {
    case "error":
      return "error"
    case "warning":
      return "warn"
    case "debug":
      return "debug"
    default:
      return "info"
  }
}

/**
 * Records the page's console, uncaught errors and main-frame navigations as app log lines. A
 * navigation the browser could not load is logged with the browser's reason (`net::ERR_…`): the
 * page it shows instead is `chrome-error://chromewebdata/`, which says nothing of why.
 */
export function recordAppLog(page: Page, steps: StepRecorder): void {
  page.on("console", (message) => {
    steps.appLog({ at: now(), level: levelOf(message), source: "console", text: message.text() })
  })
  page.on("pageerror", (error) => {
    steps.appLog({
      at: now(),
      level: "error",
      source: "page-error",
      text: error.stack ?? error.message,
    })
  })
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame())
      steps.appLog({ at: now(), level: "info", source: "navigation", text: frame.url() })
  })
  page.on("requestfailed", (request) => {
    const reason = request.failure()?.errorText

    /* A navigation the page itself called off (another one replaced it) is no failure. */
    if (!request.isNavigationRequest() || request.frame() !== page.mainFrame()) return
    if (reason === undefined || reason === "net::ERR_ABORTED") return

    steps.appLog({
      at: now(),
      level: "error",
      source: "navigation",
      text: `${request.url()} could not be loaded: ${reason}`,
    })
  })
}
