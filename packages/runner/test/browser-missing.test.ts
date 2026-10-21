import { execFile } from "node:child_process"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterAll, describe, expect, it } from "vitest"

import { codeOf } from "../src/support/codes.ts"

const LAUNCH = new URL("../src/browser/launch.ts", import.meta.url).href
const noBrowsers = mkdtempSync(join(tmpdir(), "danwo-no-browsers-"))

afterAll(() => rmSync(noBrowsers, { recursive: true, force: true }))

/** Launches danwo's browser on a machine whose Playwright browser folder is empty; what it threw. */
function launchWithoutBrowsers(): Promise<string> {
  const script = `import(${JSON.stringify(LAUNCH)}).then(({ launchBrowser }) => launchBrowser()).then(
    (browser) => browser.close().then(() => console.log("launched")),
    (error) => console.log(error.message),
  )`

  return new Promise((resolve) => {
    execFile(
      process.execPath,
      ["--input-type=module", "-e", script],
      { env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: noBrowsers } },
      (_error, stdout) => resolve(stdout.trim()),
    )
  })
}

describe("a machine without danwo's Chromium", () => {
  it("is told the install command for the build danwo drives", async () => {
    const message = await launchWithoutBrowsers()

    expect(message).toContain("npx playwright-core install chromium")
    expect(message).not.toContain("npx playwright install")
    expect(codeOf(new Error(message))).toBe("BROWSER_FAILED")
  }, 30_000)
})
