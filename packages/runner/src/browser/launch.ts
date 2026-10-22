/**
 * Starting a browser for danwo: every request goes through the run's proxy, and only the run's CA
 * is trusted on top of the system store.
 *
 * How the CA is trusted depends on the engine, and none of them changes this machine's trust store:
 * - Chromium takes the CA's public-key hash on its command line
 *   (`--ignore-certificate-errors-spki-list`), so it trusts that one key and nothing else extra.
 * - Firefox keeps certificates in its profile's own NSS store, and WebKit in the system keychain on
 *   macOS; neither has a launch flag that adds one CA. Their contexts get `ignoreHTTPSErrors`
 *   instead, and only when the danwo proxy carries every request: the browser then talks TLS to the
 *   proxy alone, which mints each site's certificate from the run's CA and checks the real site's
 *   certificate itself before passing anything on. A site with a bad certificate still fails, at
 *   the proxy, rather than in the browser.
 */
import type { Browser, BrowserContextOptions } from "playwright-core"

import { DanwoError } from "../support/codes.ts"
import { type BrowserName, browserTitle, browserType, DEFAULT_BROWSER } from "./engines.ts"

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
  /** The engine: `chromium` (default), `firefox` or `webkit`. */
  readonly engine?: BrowserName
  /** Use an installed browser instead of Playwright's Chromium, e.g. `"chrome"`; Chromium only. */
  readonly channel?: string
  /** Extra flags: `args` are added to the proxy's; `proxy` replaces the danwo proxy. */
  readonly flags?: BrowserFlags
}

/**
 * The flags that put a browser behind `proxy`. `extra.args` are added after the trust flag, so a
 * caller's own flags never drop it; `extra.proxy` replaces the danwo proxy as the server. Only
 * Chromium takes the trust flag; the other engines trust the CA through their contexts.
 */
function proxyFlags(
  proxy: BrowserProxy | undefined,
  engine: BrowserName,
  extra?: BrowserFlags,
): BrowserFlags {
  if (proxy === undefined) return extra ?? {}

  const trust =
    engine === "chromium" ? [`--ignore-certificate-errors-spki-list=${proxy.caSpki}`] : []

  return {
    proxy: extra?.proxy ?? { server: proxy.url },
    args: [...trust, ...(extra?.args ?? [])],
  }
}

/**
 * The launch options that put any Playwright's browser of `engine` behind `proxy`: its server,
 * and for Chromium the flag that trusts the proxy's CA (the other engines take
 * {@link proxyContextOptions} on their contexts). Playwright Test suites launch their own
 * Playwright's browser with these, so danwo never hands them a browser from another version.
 */
export function proxyLaunchOptions(
  proxy: BrowserProxy | undefined,
  engine: BrowserName = DEFAULT_BROWSER,
): {
  proxy?: { server: string; bypass?: string }
  args?: string[]
} {
  const flags = proxyFlags(proxy, engine)

  return {
    ...(flags.proxy && { proxy: { ...flags.proxy } }),
    ...(flags.args && flags.args.length > 0 && { args: [...flags.args] }),
  }
}

/**
 * The context options a browser of `engine` behind `proxy` needs to trust the proxy's CA: none
 * for Chromium, whose launch flag does it; `ignoreHTTPSErrors` for Firefox and WebKit, whose only
 * TLS peer is then the proxy (see the top of this file).
 */
export function proxyContextOptions(
  proxy: BrowserProxy | undefined,
  engine: BrowserName = DEFAULT_BROWSER,
): BrowserContextOptions {
  return proxy !== undefined && engine !== "chromium" ? { ignoreHTTPSErrors: true } : {}
}

/** What each browser danwo launched needs on every context it opens, to trust its proxy. */
const contextTrust = new WeakMap<Browser, BrowserContextOptions>()

/**
 * The options every context of `browser` takes so its pages trust the run's proxy: what
 * {@link proxyContextOptions} gave when danwo launched it; none for a browser it did not launch.
 */
export function trustedContextOptions(browser: Browser): BrowserContextOptions {
  return contextTrust.get(browser) ?? {}
}

/** What Playwright says when the browser build it expects was never downloaded. */
const NOT_INSTALLED = /Executable doesn't exist/

/** The command that installs the Chromium build danwo drives. */
export const INSTALL_BROWSER_COMMAND = "npx @danwo/cli install-browser"

/** The command that installs `engine`'s build danwo drives. */
export function installCommand(engine: BrowserName): string {
  return engine === "chromium"
    ? INSTALL_BROWSER_COMMAND
    : `${INSTALL_BROWSER_COMMAND} --browser ${engine}`
}

/**
 * Playwright's own advice for a missing browser is `npx playwright install`, which in a project
 * without the `playwright` package fetches its newest release, whose browsers may not be the
 * builds danwo's Playwright drives; `npx playwright-core install` runs whichever `playwright-core`
 * the project resolves first. The fix named here runs danwo's own copy.
 */
function missingBrowser(error: unknown, engine: BrowserName): unknown {
  if (!(error instanceof Error) || !NOT_INSTALLED.test(error.message)) return error

  return new Error(
    `browserType.launch: ${browserTitle(engine)} is not installed for danwo. Run \`${installCommand(engine)}\` in the project (add --with-deps on Linux, for the system libraries it needs).`,
    { cause: error },
  )
}

/** An installed Chrome or Edge (`channel`) is a Chromium; refused for any other engine. */
function checkChannel(channel: string | undefined, engine: BrowserName): void {
  if (channel === undefined || engine === "chromium") return

  throw new DanwoError(
    "CONFIG_INVALID",
    `channel "${channel}" is an installed Chrome or Edge, so it runs on chromium alone, not ${engine}`,
  )
}

/** Playwright's launch options for `options` in `engine`. */
function launchOptionsOf(options: LaunchOptions, engine: BrowserName): LaunchOptionsOf {
  const flags = proxyFlags(options.proxy, engine, options.flags)

  return {
    headless: options.headless ?? true,
    ...(options.channel && { channel: options.channel }),
    ...(flags.proxy && { proxy: flags.proxy }),
    ...(flags.args && flags.args.length > 0 && { args: [...flags.args] }),
  }
}

type LaunchOptionsOf = NonNullable<Parameters<ReturnType<typeof browserType>["launch"]>[0]>

/** Launches the run's browser (Chromium unless `options.engine` says otherwise), behind `options.proxy` when given. */
export async function launchBrowser(options: LaunchOptions = {}): Promise<Browser> {
  const engine = options.engine ?? DEFAULT_BROWSER

  checkChannel(options.channel, engine)

  try {
    const browser = await browserType(engine).launch(launchOptionsOf(options, engine))

    /* A proxy of the caller's own replaces danwo's, and danwo vouches only for its own. */
    if (options.flags?.proxy === undefined)
      contextTrust.set(browser, proxyContextOptions(options.proxy, engine))

    return browser
  } catch (error) {
    throw missingBrowser(error, engine)
  }
}
