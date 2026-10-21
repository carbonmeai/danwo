/*
 * Starting Chromium for danwo: every request goes through the run's proxy, and only the run's CA
 * is trusted on top of the system store.
 */
import { type Browser, chromium } from "playwright-core"

export interface BrowserProxy {
  /** The proxy's URL, e.g. `http://127.0.0.1:51234`. */
  readonly url: string
  /** Base64 SHA-256 of the proxy CA's public key, trusted for this browser only. */
  readonly caSpki: string
}

/** Proxy and command-line flags for a browser launch. */
export interface BrowserFlags {
  readonly proxy?: { readonly server: string; readonly bypass?: string }
  readonly args?: readonly string[]
}

export interface LaunchOptions {
  /** Route the browser through a danwo proxy and trust its per-run CA. */
  readonly proxy?: BrowserProxy
  readonly headless?: boolean
  /** Use an installed browser instead of Playwright's Chromium, e.g. `"chrome"`. */
  readonly channel?: string
  /** Extra flags: `args` are added to the proxy's; `proxy` replaces the danwo proxy. */
  readonly flags?: BrowserFlags
}

/**
 * The flags that put a browser behind `proxy`. `extra.args` are added after the trust flag, so a
 * caller's own flags never drop it; `extra.proxy` replaces the danwo proxy as the server.
 */
function proxyFlags(proxy: BrowserProxy | undefined, extra?: BrowserFlags): BrowserFlags {
  if (proxy === undefined) return extra ?? {}

  return {
    proxy: extra?.proxy ?? { server: proxy.url },
    args: [`--ignore-certificate-errors-spki-list=${proxy.caSpki}`, ...(extra?.args ?? [])],
  }
}

/** What Playwright says when the Chromium build it expects was never downloaded. */
const NOT_INSTALLED = /Executable doesn't exist/

/**
 * Playwright's own advice for a missing browser is `npx playwright install`, which in a project
 * without the `playwright` package fetches its newest release, whose Chromium may not be the build
 * danwo's Playwright drives. The fix named here installs the build danwo needs.
 */
function missingBrowser(error: unknown): unknown {
  if (!(error instanceof Error) || !NOT_INSTALLED.test(error.message)) return error

  return new Error(
    "browserType.launch: Chromium is not installed for danwo. Run `npx playwright-core install chromium` in the project (with --with-deps on Linux, for the system libraries it needs).",
    { cause: error },
  )
}

/** Launches Chromium for a run, behind `options.proxy` when given. */
export async function launchBrowser(options: LaunchOptions = {}): Promise<Browser> {
  const flags = proxyFlags(options.proxy, options.flags)

  try {
    return await chromium.launch({
      headless: options.headless ?? true,
      ...(options.channel && { channel: options.channel }),
      ...(flags.proxy && { proxy: flags.proxy }),
      ...(flags.args && { args: [...flags.args] }),
    })
  } catch (error) {
    throw missingBrowser(error)
  }
}
