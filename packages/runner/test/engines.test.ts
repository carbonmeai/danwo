/**
 * Choosing the browser engine: the config's `browser.name` and `danwo test --browser`, checked
 * and in order; how each engine trusts the proxy's CA; what a run that names engines plans and
 * prints; and what an engine does differently that its records say.
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { checkBrowserConfig } from "../src/browser/context-options.ts"
import { browserNames, engineNotes, runBrowsers } from "../src/browser/engines.ts"
import { installBrowserArgs } from "../src/browser/install.ts"
import {
  installCommand,
  launchBrowser,
  proxyContextOptions,
  proxyLaunchOptions,
} from "../src/browser/launch.ts"
import { runMatrix } from "../src/runner/matrix-command.ts"
import { openingLine, testLine } from "../src/runner/reporter.ts"
import { mergeResults } from "../src/runner/results.ts"
import type { TestReport } from "../src/runner/tasks.ts"
import { testName } from "../src/runner/tasks.ts"
import { runTests } from "../src/runner/test-command.ts"
import { codeOf } from "../src/support/codes.ts"

const PROXY = { url: "http://127.0.0.1:4000", caSpki: "c3BraQ==" }

describe("naming the engines", () => {
  it("reads one engine or a list, each once, in the order given", () => {
    expect(browserNames("firefox", "--browser")).toEqual(["firefox"])
    expect(browserNames(" WebKit , chromium,webkit", "--browser")).toEqual(["webkit", "chromium"])
    expect(browserNames(["chromium", "firefox"], "browser.name")).toEqual(["chromium", "firefox"])
  })

  it("refuses what is not an engine, saying where it was written", () => {
    expect(() => browserNames("safari,firefox", "--browser")).toThrow(
      '--browser: "safari" is not a browser danwo runs; use chromium, firefox, webkit',
    )
    expect(() => browserNames(" , ", "--browser")).toThrow("--browser names no browser")

    const refused = (() => {
      try {
        return browserNames("edge", "--browser")
      } catch (error) {
        return error
      }
    })()

    expect(codeOf(refused)).toBe("CONFIG_INVALID")
  })

  it("runs in --browser first, then the config's browser.name, else Chromium alone", () => {
    expect(runBrowsers(undefined)).toEqual(["chromium"])
    expect(runBrowsers("webkit")).toEqual(["webkit"])
    expect(runBrowsers(["firefox", "chromium"])).toEqual(["firefox", "chromium"])
    expect(runBrowsers(["firefox"], "webkit,chromium")).toEqual(["webkit", "chromium"])
  })

  it("checks browser.name when the config loads", () => {
    expect(checkBrowserConfig({ name: "firefox" })).toEqual({ name: "firefox" })
    expect(checkBrowserConfig({ name: ["chromium", "webkit"] })).toEqual({
      name: ["chromium", "webkit"],
    })
    expect(() => checkBrowserConfig({ name: "safari" })).toThrow(
      /`browser.name`: not a browser danwo runs; use chromium, firefox, webkit/,
    )
    expect(() => checkBrowserConfig({ name: [] })).toThrow(/`browser.name`/)
  })
})

describe("trusting the proxy's CA in each engine", () => {
  it("gives Chromium the CA's key on its command line, and its contexts nothing more", () => {
    expect(proxyLaunchOptions(PROXY, "chromium")).toEqual({
      proxy: { server: PROXY.url },
      args: [`--ignore-certificate-errors-spki-list=${PROXY.caSpki}`],
    })
    expect(proxyContextOptions(PROXY, "chromium")).toEqual({})
  })

  it("routes Firefox and WebKit through the proxy, their contexts ignoring certificate errors", () => {
    for (const engine of ["firefox", "webkit"] as const) {
      expect(proxyLaunchOptions(PROXY, engine)).toEqual({ proxy: { server: PROXY.url } })
      expect(proxyContextOptions(PROXY, engine)).toEqual({ ignoreHTTPSErrors: true })
    }
  })

  it("ignores no certificate error without danwo's proxy", () => {
    expect(proxyLaunchOptions(undefined, "webkit")).toEqual({})
    expect(proxyContextOptions(undefined, "firefox")).toEqual({})
  })

  it("refuses an installed Chrome's channel for another engine before launching anything", async () => {
    await expect(launchBrowser({ engine: "firefox", channel: "chrome" })).rejects.toThrow(
      'channel "chrome" is an installed Chrome or Edge, so it runs on chromium alone, not firefox',
    )
  })
})

describe("installing the engines", () => {
  it("installs Chromium by default, else the engines named, keeping other installs' browsers", () => {
    expect(installBrowserArgs().slice(1)).toEqual(["install", "chromium", "--no-remove"])
    expect(
      installBrowserArgs({ browsers: ["firefox", "webkit"], withDeps: true }).slice(1),
    ).toEqual(["install", "firefox", "webkit", "--no-remove", "--with-deps"])
  })

  it("names the install for the engine that is missing", () => {
    expect(installCommand("chromium")).toBe("npx @danwo/cli install-browser")
    expect(installCommand("webkit")).toBe("npx @danwo/cli install-browser --browser webkit")
  })
})

/** A test's report in `browser`, with one attempt of `status`. */
function report(id: string, status: "passed" | "failed", browser?: "firefox" | "webkit") {
  return {
    id,
    status,
    attempts: [{ status, error: undefined, durationMs: 5 }],
    workerIndex: 0,
    ...(browser && { browser }),
  } satisfies TestReport
}

describe("a run's results in several engines", () => {
  it("labels each test with its engine, after the id so the file stays first", () => {
    expect(testName({ id: "a.danwo.ts › signs in" })).toBe("a.danwo.ts › signs in")
    expect(testName({ id: "a.danwo.ts › signs in", browser: "webkit" })).toBe(
      "a.danwo.ts › signs in [webkit]",
    )
    expect(testLine(report("a.danwo.ts › signs in", "passed", "firefox"))).toContain(
      "a.danwo.ts › signs in [firefox]",
    )
  })

  it("says how many tests run in which engines", () => {
    expect(openingLine(3, 2)).toContain("Running 3 tests with 2 workers")
    expect(openingLine(3, 1, ["webkit"])).toContain("Running 3 tests in webkit with 1 worker")
    expect(openingLine(3, 2, ["chromium", "firefox"])).toContain(
      "Running 6 tests (3 in each of chromium, firefox) with 2 workers",
    )
  })

  it("keeps one result per test and engine when results are joined", () => {
    const merged = mergeResults([
      {
        version: 1,
        reports: [report("a › one", "passed", "firefox"), report("a › one", "failed", "webkit")],
        brokenFiles: [],
        durationMs: 10,
      },
      {
        version: 1,
        reports: [report("a › one", "passed", "webkit")],
        brokenFiles: [],
        durationMs: 5,
      },
    ])

    expect(merged.reports.map((r) => [testName(r), r.status, r.attempts.length])).toEqual([
      ["a › one [firefox]", "passed", 1],
      ["a › one [webkit]", "flaky", 2],
    ])
  })
})

describe("what an engine's records say", () => {
  it("notes that WebKit on macOS sends some requests for a localhost app around the proxy", () => {
    const [note] = engineNotes("webkit", "http://127.0.0.1:3000", "darwin")

    expect(note).toMatch(/^webkit on macOS sends some requests for an app on localhost straight/)
    expect(engineNotes("webkit", "http://localhost:3000", "darwin")).toHaveLength(1)
  })

  it("notes nothing for WebKit on Linux, another engine, or an app on a routed hostname", () => {
    expect(engineNotes("webkit", "http://127.0.0.1:3000", "linux")).toEqual([])
    expect(engineNotes("firefox", "http://127.0.0.1:3000", "darwin")).toEqual([])
    expect(engineNotes("webkit", "https://shop.test", "darwin")).toEqual([])
    expect(engineNotes("webkit", undefined, "darwin")).toEqual([])
  })
})

describe("danwo test --list in several engines", () => {
  const TESTS = new URL("../src/tests/api.ts", import.meta.url).href
  let dir: string

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "danwo-engines-"))
    await writeFile(
      join(dir, "danwo.config.ts"),
      'export default { browser: { name: ["firefox", "webkit"] } }\n',
    )
    await writeFile(
      join(dir, "shop.danwo.ts"),
      `import { test } from ${JSON.stringify(TESTS)}\n\ntest("buys a lamp", async () => {})\n`,
    )
  })

  afterAll(() => rm(dir, { recursive: true, force: true }))

  /** The tests `danwo test --list` picks in `dir`, with `options`. */
  async function listed(options: { browser?: string } = {}): Promise<unknown> {
    const lines: string[] = []

    await runTests({ cwd: dir, list: true, write: (line) => lines.push(line), ...options })

    return JSON.parse(lines.join(""))
  }

  it("lists each test once in each of the config's engines, in the order they run", async () => {
    expect(await listed()).toEqual([
      {
        id: "shop.danwo.ts › buys a lamp",
        file: "shop.danwo.ts",
        invariant: false,
        browser: "firefox",
      },
      {
        id: "shop.danwo.ts › buys a lamp",
        file: "shop.danwo.ts",
        invariant: false,
        browser: "webkit",
      },
    ])
  })

  it("runs in the engines --browser names instead, and unlabelled in Chromium alone", async () => {
    expect(await listed({ browser: "webkit" })).toEqual([
      {
        id: "shop.danwo.ts › buys a lamp",
        file: "shop.danwo.ts",
        invariant: false,
        browser: "webkit",
      },
    ])
    expect(await listed({ browser: "chromium" })).toEqual([
      { id: "shop.danwo.ts › buys a lamp", file: "shop.danwo.ts", invariant: false },
    ])
    await expect(listed({ browser: "lynx" })).rejects.toThrow('--browser: "lynx" is not a browser')
  })

  it("refuses a matrix in more than one engine, before it runs anything", async () => {
    await expect(
      runMatrix({ cwd: dir, file: "shop.danwo.ts", browser: "firefox,webkit", write: () => {} }),
    ).rejects.toThrow("danwo matrix runs in one browser; --browser names firefox, webkit")
  })
})
