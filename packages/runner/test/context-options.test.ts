/**
 * The config's `browser.contextOptions`: checked when the config loads, naming each key that is
 * wrong, and applied to every browser context a session opens, another person's included. A time
 * `time.set` is given as a wall clock is read in the configured time zone.
 */
import { once } from "node:events"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { createServer, type IncomingHttpHeaders, type Server } from "node:http"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { checkBrowserConfig } from "../src/browser/context-options.ts"
import { loadConfig } from "../src/runner/config.ts"
import { openWebSession } from "../src/session.ts"
import { instantIn } from "../src/time/zone.ts"

/** A page that prints what the browser tells it about itself, behind HTTP Basic sign-in. */
const SELF = `<!doctype html><title>Self</title><p id="out"></p><p id="clock"></p>
<script>
  document.getElementById("out").textContent = [
    navigator.language,
    Intl.DateTimeFormat().resolvedOptions().timeZone,
    matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light",
    matchMedia("(prefers-reduced-motion: reduce)").matches ? "reduce" : "motion",
    innerWidth + "x" + innerHeight,
  ].join(" ")
  document.getElementById("clock").textContent = new Date().getHours() + ":" + new Date().getMinutes()
</script>`

const BASIC = `Basic ${Buffer.from("ada:open sesame").toString("base64")}`

let server: Server
let url: string
const seen: IncomingHttpHeaders[] = []

beforeAll(async () => {
  server = createServer((req, res) => {
    seen.push(req.headers)

    if (req.headers.authorization !== BASIC) {
      res.writeHead(401, { "www-authenticate": 'Basic realm="staging"' })
      res.end("sign in")

      return
    }

    res.writeHead(200, { "content-type": "text/html" })
    res.end(SELF)
  })
  server.listen(0, "127.0.0.1")
  await once(server, "listening")

  const address = server.address()

  url = `http://127.0.0.1:${typeof address === "object" && address !== null ? address.port : 0}`
})

afterAll(async () => {
  server.close()
})

const OPTIONS = {
  reducedMotion: "reduce",
  colorScheme: "dark",
  locale: "de-DE",
  timezoneId: "America/New_York",
  viewport: { width: 800, height: 600 },
  httpCredentials: { username: "ada", password: "open sesame" },
  extraHTTPHeaders: { "x-staging-key": "k-123" },
} as const

describe("the config's browser options", () => {
  it("takes every option it knows", () => {
    expect(checkBrowserConfig({ contextOptions: OPTIONS })).toEqual({ contextOptions: OPTIONS })
    expect(checkBrowserConfig({ contextOptions: { viewport: null } })).toBeDefined()
    expect(checkBrowserConfig(undefined)).toBeUndefined()
  })

  it.each([
    [
      { contextOptions: { colourScheme: "dark" } },
      /`browser.contextOptions`: Unrecognized key: "colourScheme"/,
    ],
    [
      { contextOptions: { timezoneId: "Mars/Olympus" } },
      /`browser.contextOptions.timezoneId`: not a time zone/,
    ],
    [
      { contextOptions: { locale: "not a locale" } },
      /`browser.contextOptions.locale`: not a language tag/,
    ],
    [
      { contextOptions: { viewport: { width: 0, height: 600 } } },
      /`browser.contextOptions.viewport.width`/,
    ],
    [{ contextOptions: { colorScheme: "sepia" } }, /`browser.contextOptions.colorScheme`/],
    [
      { contextOptions: { extraHTTPHeaders: { "bad header": "x" } } },
      /extraHTTPHeaders.bad header`: Invalid key/,
    ],
    [{ contextOptions: { httpCredentials: { username: "ada" } } }, /httpCredentials.password/],
    [{ context: {} }, /`browser`: Unrecognized key: "context"/],
  ])("refuses %j", (value, message) => {
    expect(() => checkBrowserConfig(value)).toThrow(message)
  })

  it("fails the config's load with CONFIG_INVALID", async () => {
    const dir = await mkdtemp(join(tmpdir(), "danwo-browser-config-"))

    try {
      await writeFile(
        join(dir, "danwo.config.ts"),
        `export default { browser: { contextOptions: { timezoneId: "Nowhere/Land" } } }\n`,
      )
      await expect(loadConfig(dir)).rejects.toMatchObject({
        code: "CONFIG_INVALID",
        message: expect.stringContaining("browser.contextOptions.timezoneId"),
      })
    } finally {
      await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    }
  })
})

describe("a session's browser contexts", () => {
  it("open with the options, another person's too, and a wall-clock time is the page's own", async () => {
    const session = await openWebSession({ baseUrl: url, contextOptions: OPTIONS })

    try {
      await session.app.open("/")

      const said = "de-DE America/New_York dark reduce 800x600"

      await session.expect(session.screen.getByText(said)).toBeVisible()
      expect(seen.at(-1)?.["x-staging-key"]).toBe("k-123")
      expect(seen.at(-1)?.["accept-language"]).toMatch(/^de-DE/)

      const bob = await session.openUser("bob")

      await bob.app.open("/")
      await bob.expect(bob.screen.getByText(said)).toBeVisible()

      await session.time.set("2031-07-04T09:30")
      expect(session.time.now().toISOString()).toMatch(/^2031-07-04T13:30/)
      await session.app.open("/")
      await session.expect(session.screen.getByText(/^9:3\d$/)).toBeVisible()
    } finally {
      await session.close()
    }
  })
})

describe("a wall-clock time in a time zone", () => {
  it.each([
    ["2031-07-04T09:30", "America/New_York", "2031-07-04T13:30:00.000Z"],
    ["2031-01-04T09:30", "America/New_York", "2031-01-04T14:30:00.000Z"],
    ["2031-03-09T03:30", "America/New_York", "2031-03-09T07:30:00.000Z"],
    ["2031-07-04", "Asia/Tokyo", "2031-07-03T15:00:00.000Z"],
    ["2031-07-04T09:30:15.250", "UTC", "2031-07-04T09:30:15.250Z"],
  ])("reads %s in %s as %s", (wall, zone, instant) => {
    expect(new Date(instantIn(wall, zone)).toISOString()).toBe(instant)
  })

  it("reads a time with an offset, a number or a date as written", () => {
    expect(instantIn("2031-07-04T09:30Z", "Asia/Tokyo")).toBe(Date.parse("2031-07-04T09:30Z"))
    expect(instantIn("2031-07-04T09:30+02:00", "Asia/Tokyo")).toBe(Date.parse("2031-07-04T07:30Z"))
    expect(instantIn(1_000, "Asia/Tokyo")).toBe(1_000)
    expect(instantIn("2031-07-04T09:30", undefined)).toBe(new Date("2031-07-04T09:30").getTime())
  })
})
