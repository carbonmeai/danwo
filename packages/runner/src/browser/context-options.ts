/**
 * The browser context a project's tests run in: motion, colour scheme, language, time zone, window
 * size, a site's HTTP sign-in and headers sent with every request. Set once under
 * `browser.contextOptions` in the config, they apply to every browser the run opens: each test's,
 * each saved session's setup, each other person a test opens, and the MCP server's sessions. The
 * config is checked when it loads, since Node strips its types without checking them.
 */
import type { BrowserContextOptions } from "playwright-core"
import { z } from "zod"

import { DanwoError } from "../support/codes.ts"

/** Whether `zone` is a time zone the platform knows, such as `Europe/Berlin`. */
function knownZone(zone: string): boolean {
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: zone }).resolvedOptions().timeZone !== ""
  } catch {
    return false
  }
}

/** Whether `locale` is a well-formed language tag, such as `de-DE`. */
function knownLocale(locale: string): boolean {
  try {
    return Intl.getCanonicalLocales(locale).length === 1
  } catch {
    return false
  }
}

/** An HTTP header's name: a token, as RFC 9110 allows. */
const HEADER_NAME = /^[!#$%&'*+.^`|~\w-]+$/

const contextOptions = z.strictObject({
  /** `reduce` asks pages to cut their animations, as a person who set the system option would. */
  reducedMotion: z.enum(["reduce", "no-preference"]).optional(),
  /** What `prefers-color-scheme` answers. */
  colorScheme: z.enum(["light", "dark", "no-preference"]).optional(),
  /** The browser's language, e.g. `de-DE`: `navigator.language`, `Accept-Language`, number formats. */
  locale: z
    .string()
    .refine(knownLocale, { message: "not a language tag, such as de-DE" })
    .optional(),
  /** The page's time zone, e.g. `America/New_York`. */
  timezoneId: z
    .string()
    .refine(knownZone, { message: "not a time zone, such as America/New_York" })
    .optional(),
  /** The page's size in CSS pixels (default 1280×720); `null` uses the window's own size. */
  viewport: z
    .strictObject({ width: z.int().positive(), height: z.int().positive() })
    .nullable()
    .optional(),
  /** A user name and password for HTTP authentication, sent to `origin` alone when given. */
  httpCredentials: z
    .strictObject({
      username: z.string(),
      password: z.string(),
      origin: z.url().optional(),
      send: z.enum(["unauthorized", "always"]).optional(),
    })
    .optional(),
  /** Headers sent with every request the browser makes, to every host. */
  extraHTTPHeaders: z
    .record(z.string().regex(HEADER_NAME, { message: "not a header name" }), z.string())
    .optional(),
})

const browserConfig = z.strictObject({ contextOptions: contextOptions.optional() })

/** The options of every browser context a run opens. */
export type ContextOptions = z.infer<typeof contextOptions>

/** The config's `browser` key. */
export type BrowserConfig = z.infer<typeof browserConfig>

/** Where in the config a problem is, as `browser.contextOptions.viewport.width`. */
function pathOf(issue: z.core.$ZodIssue): string {
  return ["browser", ...issue.path.map(String)].join(".")
}

/**
 * The config's `browser` key, checked; throws `CONFIG_INVALID` naming each key that is wrong, and
 * each key it does not know.
 */
export function checkBrowserConfig(value: unknown): BrowserConfig | undefined {
  if (value === undefined) return undefined

  const parsed = browserConfig.safeParse(value)

  if (parsed.success) return parsed.data

  const problems = parsed.error.issues.map((issue) => `\`${pathOf(issue)}\`: ${issue.message}`)

  throw new DanwoError("CONFIG_INVALID", `the config's browser options: ${problems.join("; ")}`)
}

/**
 * The options as Playwright's `newContext` takes them: the same keys and values, with the keys
 * left unset dropped, since Playwright reads an `undefined` as a value.
 */
export function playwrightOptions(options: ContextOptions | undefined): BrowserContextOptions {
  const taken: BrowserContextOptions = {}

  for (const [key, value] of Object.entries(options ?? {}))
    if (value !== undefined) Reflect.set(taken, key, value)

  return taken
}
