/**
 * Installing the browser builds danwo drives (Chromium, and Firefox or WebKit when asked), with
 * danwo's own `playwright-core`. A project's `npx playwright-core install` runs whichever copy the
 * project resolves first, and a different version downloads different browser revisions; this one
 * always matches the runner's.
 */
import { createRequire } from "node:module"
import { dirname, join } from "node:path"

import { spawnOwned } from "../support/children.ts"
import { type BrowserName, browserTitle, DEFAULT_BROWSER } from "./engines.ts"
import { launchBrowser } from "./launch.ts"

export interface InstallBrowserOptions {
  /** The engines to install; default Chromium alone. */
  readonly browsers?: readonly BrowserName[]
  /** Also install the system libraries the browsers need (Linux; may ask for sudo). */
  readonly withDeps?: boolean
  /**
   * Only Chromium's headless shell, which test runs use: a smaller download for CI. `danwo record`
   * needs the full browser. Firefox and WebKit have no separate shell, so it changes nothing for them.
   */
  readonly onlyShell?: boolean
  /** Print what would be installed and where, and install nothing. */
  readonly dryRun?: boolean
}

/** The `playwright-core` command-line script of danwo's own copy. */
function playwrightCli(): string {
  const require = createRequire(import.meta.url)

  return join(dirname(require.resolve("playwright-core/package.json")), "cli.js")
}

/**
 * The arguments that install the browsers with danwo's `playwright-core`. `--no-remove` keeps the
 * browsers other Playwright installs on this machine use: an install otherwise deletes the ones it
 * thinks unused from the shared cache.
 */
export function installBrowserArgs(options: InstallBrowserOptions = {}): string[] {
  const browsers =
    options.browsers === undefined || options.browsers.length === 0
      ? [DEFAULT_BROWSER]
      : options.browsers

  return [
    playwrightCli(),
    "install",
    ...browsers,
    "--no-remove",
    ...(options.withDeps === true ? ["--with-deps"] : []),
    ...(options.onlyShell === true ? ["--only-shell"] : []),
    ...(options.dryRun === true ? ["--dry-run"] : []),
  ]
}

/** Installs danwo's browsers, its output on this terminal; resolves with the installer's exit code. */
export async function installBrowser(options: InstallBrowserOptions = {}): Promise<number> {
  const { child } = spawnOwned(process.execPath, installBrowserArgs(options), { stdio: "inherit" })

  return new Promise((resolve) => {
    child.once("error", () => resolve(1))
    child.once("exit", (code, signal) => resolve(code ?? (signal === null ? 1 : 130)))
  })
}

/**
 * Whether danwo's build of `engine` (default Chromium) starts here: its version, or the first
 * line of why it did not.
 */
export async function browserInstalled(engine: BrowserName = DEFAULT_BROWSER): Promise<{
  readonly ok: boolean
  readonly detail: string
}> {
  try {
    const browser = await launchBrowser({ headless: true, engine })
    const version = browser.version()

    await browser.close()

    return { ok: true, detail: `${browserTitle(engine)} ${version}` }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)

    return { ok: false, detail: message.split("\n")[0] ?? message }
  }
}
