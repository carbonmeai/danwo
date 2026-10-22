/**
 * The browser engines a run can test in: Chromium (the default), Firefox and WebKit, each the
 * build danwo's own Playwright drives. The config's `browser.name` picks one or several; several
 * run the suite once per engine, every result labelled with the engine it ran in.
 */
import { type BrowserType, chromium, firefox, webkit } from "playwright-core"

import { DanwoError } from "../support/codes.ts"

/** Every engine danwo launches, in the order a run goes through them. */
export const BROWSER_NAMES = ["chromium", "firefox", "webkit"] as const

/** One of the engines danwo launches. */
export type BrowserName = (typeof BROWSER_NAMES)[number]

/** The engine a run uses when the config and the command line name none. */
export const DEFAULT_BROWSER: BrowserName = "chromium"

/** Whether `value` names an engine danwo launches. */
function isBrowserName(value: unknown): value is BrowserName {
  return BROWSER_NAMES.some((name) => name === value)
}

/** Playwright's launcher for `name`. */
export function browserType(name: BrowserName): BrowserType {
  if (name === "firefox") return firefox
  if (name === "webkit") return webkit

  return chromium
}

/** How an engine is written in messages: `Chromium`, `Firefox`, `WebKit`. */
export function browserTitle(name: BrowserName): string {
  if (name === "webkit") return "WebKit"

  return `${name.charAt(0).toUpperCase()}${name.slice(1)}`
}

/**
 * The engines a list names, each once, in the order given: `firefox`, `chromium,webkit` or
 * `["firefox", "webkit"]`. Throws `CONFIG_INVALID` naming what is not an engine, and where it
 * came from (`--browser`, `browser.name`).
 */
export function browserNames(value: string | readonly string[], from: string): BrowserName[] {
  const listed = (typeof value === "string" ? value.split(",") : value).map((name) =>
    name.trim().toLowerCase(),
  )
  const unknown = listed.filter((name) => !isBrowserName(name))

  if (listed.every((name) => name === ""))
    throw new DanwoError(
      "CONFIG_INVALID",
      `${from} names no browser: use ${BROWSER_NAMES.join(", ")}`,
    )
  if (unknown.length > 0)
    throw new DanwoError(
      "CONFIG_INVALID",
      `${from}: ${unknown.map((name) => `"${name}"`).join(", ")} is not a browser danwo runs; use ${BROWSER_NAMES.join(", ")}`,
    )

  return [...new Set(listed.filter(isBrowserName))]
}

/** Whether `url` is an app on this machine's loopback: `localhost`, `127.x.x.x` or `[::1]`. */
function onLoopback(url: string | undefined): boolean {
  if (url === undefined) return false

  try {
    const host = new URL(url).hostname

    return (
      host === "localhost" ||
      host.endsWith(".localhost") ||
      host.startsWith("127.") ||
      host === "[::1]"
    )
  } catch {
    return false
  }
}

/**
 * What an engine does differently from Chromium that a run's records should say, given the app's
 * URL and this machine's platform. WebKit on macOS sends some requests for an app on the loopback
 * (the preloads its parser finds ahead of time) straight to the app instead of through the proxy,
 * written as proxy requests: the record misses them, and the app reads the whole URL as the path.
 * WebKit on Linux and the other engines send everything through the proxy.
 */
export function engineNotes(
  engine: BrowserName,
  appUrl: string | undefined,
  platform: NodeJS.Platform = process.platform,
): string[] {
  if (engine !== "webkit" || platform !== "darwin" || !onLoopback(appUrl)) return []

  return [
    "webkit on macOS sends some requests for an app on localhost straight to the app, around danwo's proxy: they are missing from this record, and the app receives them with the whole URL as the path. Run WebKit on Linux (as CI does) for a full record.",
  ]
}

/**
 * The engines a run tests in: the command line's `--browser` when given, else the config's
 * `browser.name`, else Chromium alone.
 */
export function runBrowsers(
  configured: BrowserName | readonly BrowserName[] | undefined,
  flag?: string,
): readonly BrowserName[] {
  if (flag !== undefined) return browserNames(flag, "--browser")
  if (configured === undefined) return [DEFAULT_BROWSER]

  return browserNames(typeof configured === "string" ? [configured] : configured, "browser.name")
}
