/** The app's side of an attempt: what it wrote to the console, page errors, and where it went. */
import type { ConsoleMessage, Page } from "playwright-core"

import type { AppLogRecord, StepRecorder } from "./steps.ts"

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

/** Records the page's console, uncaught errors and main-frame navigations as app log lines. */
export function recordAppLog(page: Page, steps: StepRecorder): void {
  const at = () => new Date().toISOString()

  page.on("console", (message) => {
    steps.appLog({ at: at(), level: levelOf(message), source: "console", text: message.text() })
  })
  page.on("pageerror", (error) => {
    steps.appLog({
      at: at(),
      level: "error",
      source: "page-error",
      text: error.stack ?? error.message,
    })
  })
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame())
      steps.appLog({ at: at(), level: "info", source: "navigation", text: frame.url() })
  })
}
