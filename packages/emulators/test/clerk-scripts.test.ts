import { existsSync } from "node:fs"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join, sep } from "node:path"

import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { clerk } from "../src/clerk/index.ts"
import { downloadScript, loadScript } from "../src/clerk/scripts.ts"
import { createEmulator } from "../src/define.ts"

const FAPI = "https://danwo-app.clerk.accounts.dev"
const require = createRequire(import.meta.url)

/** A file of an installed package (found from its entry point), as the emulator should serve it. */
function installed(name: "@clerk/clerk-js" | "@clerk/ui", file: string): Promise<string> {
  const entry = require.resolve(name)
  /* The resolved path takes the platform's separator, `@clerk\clerk-js` on Windows. */
  const folder = name.replaceAll("/", sep)

  return readFile(join(entry.slice(0, entry.indexOf(folder) + folder.length), file), "utf8")
}

describe("Clerk's browser scripts", () => {
  const emulator = createEmulator(clerk)
  const get = (path: string) => emulator.fetch(new Request(new URL(path, FAPI)))

  it("serves the installed ClerkJS and @clerk/ui builds from the Frontend API host", async () => {
    const script = await get("/npm/@clerk/clerk-js@6/dist/clerk.browser.js")

    expect(script.status).toBe(200)
    expect(script.headers.get("content-type")).toMatch(/javascript/)
    expect(await script.text()).toBe(await installed("@clerk/clerk-js", "dist/clerk.browser.js"))

    const ui = await get("/npm/@clerk/ui@1/dist/ui.browser.js")

    expect(await ui.text()).toBe(await installed("@clerk/ui", "dist/ui.browser.js"))
  })

  it("serves nothing outside those packages", async () => {
    expect((await get("/npm/@clerk/clerk-js@6/../../package.json")).status).toBe(404)
    expect((await get("/npm/left-pad@1/index.js")).status).toBe(404)
  })
})

/** A CDN that answers with the script. */
const ok = () => new Response("console.log(1)", { status: 200 })

/** A CDN that has no such file. */
const missing = () => new Response("", { status: 404, statusText: "Not Found" })

describe("downloading a ClerkJS script from the CDN", () => {
  it("tries again after a network error, a 5xx or a 404, and gets the file", async () => {
    const answers: (() => Response)[] = [
      () => {
        throw new TypeError("fetch failed")
      },
      () => new Response("", { status: 503 }),
      missing,
      ok,
    ]
    let calls = 0
    const download = await downloadScript("https://cdn.test/a.js", {
      fetch: async () => (answers[calls++] ?? ok)(),
      backoffMs: 0,
    })

    expect(download.ok && download.bytes.toString()).toBe("console.log(1)")
    expect(calls).toBe(4)
  })

  it("gives up after four failed tries, and says why", async () => {
    let calls = 0

    const failing = async () => {
      calls += 1
      throw new TypeError("fetch failed")
    }

    expect(await downloadScript("https://cdn.test/a.js", { fetch: failing, backoffMs: 0 })).toEqual(
      { ok: false, reason: "fetch failed" },
    )
    expect(calls).toBe(4)

    calls = 0

    const notThere = async () => {
      calls += 1

      return missing()
    }

    expect(
      await downloadScript("https://cdn.test/a.js", { fetch: notThere, backoffMs: 0 }),
    ).toEqual({ ok: false, reason: "404 Not Found" })
    expect(calls).toBe(4)
  })

  it("waits longer before each try, a few seconds in all", async () => {
    const started = Date.now()

    await downloadScript("https://cdn.test/a.js", { fetch: async () => missing(), backoffMs: 20 })

    /* 20 + 40 + 80 ms: the default 500 ms makes 3.5 s. */
    expect(Date.now() - started).toBeGreaterThanOrEqual(130)
  })
})

/** A CDN that answers `answers` by URL, 404 for any other, and notes each URL it is asked. */
function cdn(answers: Readonly<Record<string, () => Response>>) {
  const asked: string[] = []

  const fetch = async (input: string | URL | Request) => {
    const url = input instanceof Request ? input.url : String(input)

    asked.push(url)

    return (answers[url] ?? missing)()
  }

  return { asked, fetch }
}

describe("finding a ClerkJS script that isn't installed", () => {
  const UI = "/npm/@clerk/ui@1/dist/ui.browser.js"
  const RESOLVE = "https://data.jsdelivr.com/v1/packages/npm/@clerk/ui/resolved?specifier=1"
  const EXACT = "https://cdn.jsdelivr.net/npm/@clerk/ui@1.41.2/dist/ui.browser.js"
  let cacheDir = ""

  /** Puts `body` in the cache as the file of `version`. */
  async function cache(version: string, body: string): Promise<void> {
    const path = join(cacheDir, `@clerk/ui@${version}`, "dist/ui.browser.js")

    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, body)
  }

  beforeEach(async () => {
    cacheDir = await mkdtemp(join(tmpdir(), "danwo-clerk-scripts-"))
  })

  afterEach(async () => {
    await rm(cacheDir, { recursive: true, force: true })
  })

  it("resolves a range like @1 to an exact version once, and caches the file under it", async () => {
    const { asked, fetch } = cdn({
      [RESOLVE]: () => Response.json({ version: "1.41.2" }),
      [EXACT]: ok,
    })
    const options = { fetch, backoffMs: 0, cacheDir, installed: false }

    const first = await loadScript(UI, options)
    const second = await loadScript(UI, options)

    expect(first?.ok && first.bytes.toString()).toBe("console.log(1)")
    expect(second?.ok && second.bytes.toString()).toBe("console.log(1)")
    expect(asked).toEqual([RESOLVE, EXACT])
    expect(existsSync(join(cacheDir, "@clerk/ui@1.41.2/dist/ui.browser.js"))).toBe(true)
  })

  it("serves the newest cached copy the range stands for when the CDN can't be reached", async () => {
    await cache("1.39.0", "older")
    await cache("1.40.2", "newer")
    await cache("2.0.0", "other major")

    const warnings: string[] = []
    const script = await loadScript(UI, {
      fetch: async () => {
        throw new TypeError("fetch failed")
      },
      backoffMs: 0,
      cacheDir,
      installed: false,
      warn: (message) => warnings.push(message),
    })

    expect(script?.ok && script.bytes.toString()).toBe("newer")
    expect(warnings).toEqual([])
  })

  it("names the URL and the CDN's answer when the script can't be had", async () => {
    const { fetch } = cdn({ [RESOLVE]: () => Response.json({ version: "1.41.2" }) })
    const warnings: string[] = []
    const script = await loadScript(UI, {
      fetch,
      backoffMs: 0,
      cacheDir,
      installed: false,
      warn: (message) => warnings.push(message),
    })

    expect(script?.ok).toBe(false)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain(EXACT)
    expect(warnings[0]).toContain("404 Not Found")
  })

  it("falls back to the range itself when the CDN can't resolve it", async () => {
    const range = "https://cdn.jsdelivr.net/npm/@clerk/ui@1/dist/ui.browser.js"
    const { asked, fetch } = cdn({ [range]: ok })
    const script = await loadScript(UI, { fetch, backoffMs: 0, cacheDir, installed: false })

    expect(script?.ok && script.bytes.toString()).toBe("console.log(1)")
    expect(asked.at(-1)).toBe(range)
  })
})
