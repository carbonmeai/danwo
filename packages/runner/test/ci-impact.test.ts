import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { Exchange } from "@danwo/proxy"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import type { AppLogRecord } from "../src/record/index.ts"
import { ciDefaults, inCi, parseShard, shardFiles } from "../src/runner/ci.ts"
import { impactOf, localImportsOf, selectImpacted, selectionLines } from "../src/runner/impact.ts"
import { matrixRunXml, testRunXml } from "../src/runner/junit.ts"
import { failedIds, flakyIds, mergeResults, type RunResults } from "../src/runner/results.ts"
import type { AttemptReport, TestReport } from "../src/runner/tasks.ts"

const passed: AttemptReport = { status: "passed", error: undefined, durationMs: 10 }
const failed: AttemptReport = {
  status: "failed",
  error: { code: "EXPECTATION_FAILED", class: "test", name: "AssertionError", message: "no" },
  durationMs: 20,
}

function report(id: string, attempts: readonly AttemptReport[], status: TestReport["status"]) {
  return { id, status, attempts, workerIndex: 0 } satisfies TestReport
}

function results(reports: readonly TestReport[], brokenFiles: RunResults["brokenFiles"] = []) {
  return { version: 1, reports, brokenFiles, durationMs: 100 } satisfies RunResults
}

describe("CI defaults", () => {
  it("reads CI from the environment, treating false and 0 as unset", () => {
    expect(inCi({ CI: "true" })).toBe(true)
    expect(inCi({ CI: "1" })).toBe(true)
    expect(inCi({ CI: "false" })).toBe(false)
    expect(inCi({ CI: "0" })).toBe(false)
    expect(inCi({ CI: "" })).toBe(false)
    expect(inCi({})).toBe(false)
  })

  it("retries once, reads the cache only and refuses .only in CI", () => {
    expect(ciDefaults(true)).toEqual({ retries: 1, cacheReadOnly: true, forbidOnly: true })
    expect(ciDefaults(false)).toEqual({ retries: 0, cacheReadOnly: false, forbidOnly: false })
  })
})

describe("sharding", () => {
  const files = [
    "/p/tests/e.ts",
    "/p/tests/a.ts",
    "/p/tests/d.ts",
    "/p/tests/c.ts",
    "/p/tests/b.ts",
  ]

  it("splits sorted files so the shards cover every file exactly once", () => {
    const shards = [1, 2, 3].map((index) => shardFiles(files, { index, total: 3 }))

    expect(shards).toEqual([
      ["/p/tests/a.ts", "/p/tests/d.ts"],
      ["/p/tests/b.ts", "/p/tests/e.ts"],
      ["/p/tests/c.ts"],
    ])
    expect(shards.flat().toSorted()).toEqual(files.toSorted())
  })

  it("reads i/n and refuses anything else", () => {
    expect(parseShard("2/4")).toEqual({ index: 2, total: 4 })
    expect(() => parseShard("5/4")).toThrow(/--shard takes i\/n/)
    expect(() => parseShard("0/4")).toThrow(/--shard/)
    expect(() => parseShard("two")).toThrow(/--shard/)
  })
})

describe("merging results", () => {
  it("folds a rerun into the run it repeats: failed then passed is flaky", () => {
    const first = results([report("a", [passed], "passed"), report("b", [failed], "failed")])
    const rerun = results([report("b", [passed], "passed")])
    const merged = mergeResults([first, rerun])

    expect(merged.reports.map((r) => [r.id, r.status, r.attempts.length])).toEqual([
      ["a", "passed", 1],
      ["b", "flaky", 2],
    ])
    expect(flakyIds(merged)).toEqual(new Set(["b"]))
    expect(failedIds(first)).toEqual(["b"])
    expect(merged.durationMs).toBe(200)
  })

  it("keeps a test that failed again as failed, and joins shards side by side", () => {
    const merged = mergeResults([
      results([report("a", [failed], "failed")]),
      results([report("a", [failed], "failed"), report("c", [passed], "passed")]),
    ])

    expect(merged.reports.map((r) => r.status)).toEqual(["failed", "passed"])
  })

  it("drops a broken file a later run ran, and keeps one it did not", () => {
    const merged = mergeResults([
      results(
        [],
        [
          { file: "tests/x.danwo.ts", error: "SyntaxError" },
          { file: "tests/y.danwo.ts", error: "SyntaxError" },
        ],
      ),
      results([report("tests/x.danwo.ts › t", [passed], "passed")]),
    ])

    expect(merged.brokenFiles).toEqual([{ file: "tests/y.danwo.ts", error: "SyntaxError" }])
  })
})

function exchange(method: string, host: string, path: string): Exchange {
  return {
    id: "x1",
    disposition: "routed",
    method,
    host,
    path,
    status: 200,
    startedAt: new Date(0).toISOString(),
    durationMs: 1,
    fault: null,
    aborted: false,
  }
}

function log(source: AppLogRecord["source"], text: string): AppLogRecord {
  return { at: "", level: "info", source, text, step: 0 }
}

describe("what a test touched", () => {
  it("keeps the app's own pages with ids folded, and calls and webhooks behind them", () => {
    const impact = impactOf({
      appLog: [
        log("navigation", "http://127.0.0.1:4000/"),
        log("navigation", "http://127.0.0.1:4000/orders/ord_7Hk2x9Qa3?x=1"),
        log("navigation", "https://checkout.stripe.com/c/cs_test_1"),
        log("console", "http://127.0.0.1:4000/x"),
      ],
      exchanges: [
        exchange("POST", "api.stripe.com", "/v1/checkout/sessions"),
        exchange("POST", "api.stripe.com", "/v1/checkout/sessions"),
        exchange("GET", "api.stripe.com", "/v1/customers/cus_N4Kp9xQe2?expand[]=x"),
      ],
      deliveries: [
        {
          messageId: 1,
          topic: "checkout.session.completed",
          endpointId: "we_1",
          attempt: 1,
          at: "",
          status: 200,
          error: null,
          durationMs: 1,
          delivered: true,
          fault: null,
        },
      ],
      baseUrl: "http://127.0.0.1:4000",
    })

    expect(impact).toEqual({
      routes: ["/", "/orders/:id"],
      calls: [
        "GET api.stripe.com/v1/customers/:id",
        "POST api.stripe.com/v1/checkout/sessions",
        "webhook checkout.session.completed",
      ],
    })
  })
})

describe("selecting by change", () => {
  const tests = [
    { id: "tests/buy.danwo.ts › buys", file: "tests/buy.danwo.ts", imports: ["src/ledger.ts"] },
    { id: "tests/home.danwo.ts › home", file: "tests/home.danwo.ts", imports: [] },
    { id: "tests/new.danwo.ts › new", file: "tests/new.danwo.ts", imports: [] },
  ]
  const index = {
    version: 1,
    tests: {
      "tests/buy.danwo.ts › buys": {
        file: "tests/buy.danwo.ts",
        routes: ["/", "/done"],
        calls: ["POST api.stripe.com/v1/checkout/sessions", "webhook checkout.session.completed"],
      },
      "tests/home.danwo.ts › home": { file: "tests/home.danwo.ts", routes: ["/"], calls: [] },
    },
  } as const
  const config = {
    rules: {
      "src/webhooks.ts": ["webhook checkout.session.completed"],
      "src/billing/**": ["api.stripe.com"],
      "src/pages/done.ts": ["/done"],
      "src/server.ts": ["/"],
    },
  }
  const select = (changes: string[]) => selectImpacted(changes, { tests, index, config })
  const ids = (changes: string[]) => [...select(changes).reasons.keys()].toSorted()

  it("selects a test by its own file and the files it imports", () => {
    expect(ids(["tests/home.danwo.ts"])).toEqual(["tests/home.danwo.ts › home"])
    expect(select(["src/ledger.ts"]).reasons.get("tests/buy.danwo.ts › buys")).toEqual([
      "the test imports src/ledger.ts",
    ])
  })

  it("maps app files through the rules to the pages, hosts and webhooks tests touched", () => {
    expect(ids(["src/webhooks.ts"])).toEqual([
      "tests/buy.danwo.ts › buys",
      "tests/new.danwo.ts › new",
    ])
    expect(ids(["src/billing/charge.ts"])).toEqual([
      "tests/buy.danwo.ts › buys",
      "tests/new.danwo.ts › new",
    ])
    expect(ids(["src/pages/done.ts"])).toEqual([
      "tests/buy.danwo.ts › buys",
      "tests/new.danwo.ts › new",
    ])
    expect(ids(["src/server.ts"])).toHaveLength(3)
    expect(select(["src/webhooks.ts"]).reasons.get("tests/new.danwo.ts › new")).toEqual([
      "src/webhooks.ts (src/webhooks.ts) → no impact data yet",
    ])
  })

  it("selects every test for a change nothing explains, and nothing for an ignored one", () => {
    const lock = select(["bun.lock"])

    expect(lock.all).toBe(true)
    expect(lock.unmapped).toEqual(["bun.lock"])
    expect(selectionLines(lock, 3)).toEqual([
      "unmapped: bun.lock (selects every test)",
      "selected: all 3 tests",
    ])

    const docs = select(["README.md", "docs/guide.txt"])

    expect(docs.all).toBe(false)
    expect(docs.reasons.size).toBe(0)
    expect(selectionLines(docs, 3)).toEqual([
      "ignored: README.md (no test depends on it)",
      "ignored: docs/guide.txt (no test depends on it)",
      "selected: 0 of 3 tests",
    ])
  })
})

describe("a test's imports", () => {
  let root: string

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "danwo-imports-"))
    await mkdir(join(root, "tests"), { recursive: true })
    await mkdir(join(root, "lib"), { recursive: true })
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it("follows relative imports through other files, leaving packages out", async () => {
    await writeFile(
      join(root, "tests", "a.danwo.ts"),
      'import { test } from "@danwo/sdk"\nimport { greet } from "../lib/greet.ts"\nawait import("../lib/late")\n',
    )
    await writeFile(join(root, "lib", "greet.ts"), 'export { name } from "./name.ts"\n')
    await writeFile(join(root, "lib", "name.ts"), 'import "node:fs"\nexport const name = "a"\n')
    await writeFile(join(root, "lib", "late.ts"), "export const late = 1\n")

    expect(localImportsOf(join(root, "tests", "a.danwo.ts"), root)).toEqual([
      "lib/greet.ts",
      "lib/late.ts",
      "lib/name.ts",
    ])
  })
})

describe("JUnit XML", () => {
  it("writes a suite per file with passed, failed, flaky and skipped cases", () => {
    const xml = testRunXml({
      kind: "test",
      root: "/p",
      cwd: "/p",
      reports: [
        report("tests/a.danwo.ts › passes", [passed], "passed"),
        report("tests/a.danwo.ts › fails <here>", [failed], "failed"),
        report("tests/b.danwo.ts › flaky", [failed, passed], "flaky"),
        report("tests/b.danwo.ts › skipped", [], "skipped"),
      ],
      brokenFiles: [{ file: "tests/c.danwo.ts", error: "SyntaxError: x" }],
      durationMs: 1500,
      reportPath: undefined,
    })

    expect(xml).toContain('<testsuites name="danwo" time="1.500">')
    expect(xml).toContain('<testsuite name="tests/a.danwo.ts" tests="2" failures="1" skipped="0">')
    expect(xml).toContain('name="fails &#60;here&#62;"')
    expect(xml).toContain('<failure message="EXPECTATION_FAILED: no" type="EXPECTATION_FAILED">')
    expect(xml).toContain("<system-out>flaky: passed after EXPECTATION_FAILED: no</system-out>")
    expect(xml).toContain("<skipped/>")
    expect(xml).toContain('<error message="SyntaxError: x"/>')
  })

  it("writes a matrix run as one suite with a case per run", () => {
    const outcome = {
      exchanges: [],
      deliveries: [],
      divergence: undefined,
      notes: [],
    }
    const xml = matrixRunXml({
      kind: "matrix",
      root: "/p",
      cwd: "/p",
      testId: "tests/buy.danwo.ts › buys",
      file: "tests/buy.danwo.ts",
      durationMs: 2000,
      reportPath: undefined,
      result: {
        clean: { ...outcome, fault: null, status: "passed", error: null },
        runs: [
          {
            ...outcome,
            fault: {
              target: "webhook",
              topic: "checkout.session.completed",
              occurrence: 0,
              fault: { kind: "duplicate" },
              label: "duplicate on webhook checkout.session.completed",
            },
            status: "failed",
            error: "invariant: expected 1000 to be 500",
          },
        ],
      },
    })

    expect(xml).toContain('tests="2" failures="1"')
    expect(xml).toContain('name="clean run"></testcase>')
    expect(xml).toContain('<failure message="invariant: expected 1000 to be 500">')
  })
})
