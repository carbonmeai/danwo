import { readFile } from "node:fs/promises"
import { createRequire } from "node:module"
import { join, sep } from "node:path"

import { describe, expect, it } from "vitest"

import { clerk } from "../src/clerk/index.ts"
import { downloadScript } from "../src/clerk/scripts.ts"
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

describe("downloading a ClerkJS script from the CDN", () => {
  it("tries again after a network error or a 5xx, and gets the file", async () => {
    const answers: (() => Response)[] = [
      () => {
        throw new TypeError("fetch failed")
      },
      () => new Response("", { status: 503 }),
      ok,
    ]
    let calls = 0
    const bytes = await downloadScript("https://cdn.test/a.js", {
      fetch: async () => (answers[calls++] ?? ok)(),
      backoffMs: 0,
    })

    expect(bytes?.toString()).toBe("console.log(1)")
    expect(calls).toBe(3)
  })

  it("gives up after three failed tries, and at once on a 404", async () => {
    let calls = 0

    const failing = async () => {
      calls += 1
      throw new TypeError("fetch failed")
    }

    expect(await downloadScript("https://cdn.test/a.js", { fetch: failing, backoffMs: 0 })).toBe(
      undefined,
    )
    expect(calls).toBe(3)

    calls = 0

    const missing = async () => {
      calls += 1

      return new Response("", { status: 404 })
    }

    expect(await downloadScript("https://cdn.test/a.js", { fetch: missing, backoffMs: 0 })).toBe(
      undefined,
    )
    expect(calls).toBe(1)
  })
})
