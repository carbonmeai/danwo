// danwo's test declarations: modes, hook order, lazy fixtures, the parameter reader and retries.
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

import { test } from "../src/tests/api.ts"
import { findTestFiles } from "../src/tests/discover.ts"
import { fixtureScope, wantedByAll } from "../src/tests/fixtures.ts"
import { wantedBy } from "../src/tests/parameters.ts"
import { declarationsOf, hooksAround, suiteHooks } from "../src/tests/registry.ts"
import { resultOf, worthRetrying } from "../src/tests/retry.ts"
import { isSkipSignal } from "../src/tests/skip.ts"

const noop = () => undefined

describe("declarations", () => {
  it("records titles, options and modes, inheriting skip and only from describe", async () => {
    const declared = await declarationsOf(async () => {
      test("plain", noop)
      test("with options", { retries: 2, timeout: 5 }, noop)
      test("skipped by option", { skip: "later" }, noop)
      test.skip("skipped", noop)
      test.only("focused", noop)
      test.describe.skip("off", () => {
        test("inside off", noop)
      })
      test.describe.only("on", () => {
        test("inside on", noop)
      })
    })

    expect(declared.tests.map((t) => [t.titlePath.join(" › "), t.mode])).toEqual([
      ["plain", "normal"],
      ["with options", "normal"],
      ["skipped by option", "skip"],
      ["skipped", "skip"],
      ["focused", "only"],
      ["off › inside off", "skip"],
      ["on › inside on", "only"],
    ])
    expect(declared.tests[1]?.options).toEqual({ retries: 2, timeout: 5 })
  })

  it("refuses declarations outside a loading file and async describe bodies", async () => {
    expect(() => test("stray", noop)).toThrow(/while danwo loads a test file/)
    await expect(
      declarationsOf(async () => {
        test.describe("async", (async () => undefined) as unknown as () => void)
      }),
    ).rejects.toThrow(/synchronous body/)
  })

  it("orders beforeEach outermost first and afterEach innermost first", async () => {
    const declared = await declarationsOf(async () => {
      test.beforeEach(noop)
      test.afterEach(noop)
      test.describe("outer", () => {
        test.beforeEach(noop)
        test.afterEach(noop)
        test.describe("inner", () => {
          test.beforeEach(noop)
          test.afterEach(noop)
          test("deep", noop)
        })
      })
    })
    const deep = declared.tests[0]
    const where = (hook: { block?: { title: string } | undefined }) => hook.block?.title ?? "file"

    expect(deep).toBeDefined()
    if (deep === undefined) return

    expect(hooksAround(declared, deep, "beforeEach").map(where)).toEqual(["file", "outer", "inner"])
    expect(hooksAround(declared, deep, "afterEach").map(where)).toEqual(["inner", "outer", "file"])
  })

  it("orders afterAll innermost first", async () => {
    const declared = await declarationsOf(async () => {
      test.afterAll(noop)
      test.beforeAll(noop)
      test.describe("block", () => {
        test.afterAll(noop)
        test.beforeAll(noop)
      })
    })
    const where = (hook: { block?: { title: string } | undefined }) => hook.block?.title ?? "file"

    expect(suiteHooks(declared, "beforeAll").map(where)).toEqual(["file", "block"])
    expect(suiteHooks(declared, "afterAll").map(where)).toEqual(["block", "file"])
  })

  it("skips a running test with test.skip(reason) or a true condition", () => {
    const caught = (fn: () => void) => {
      try {
        fn()
      } catch (error) {
        return error
      }

      return undefined
    }

    expect(isSkipSignal(caught(() => test.skip("not today")))).toBe(true)
    expect(isSkipSignal(caught(() => test.skip(true, "on CI")))).toBe(true)
    expect(caught(() => test.skip(false, "never"))).toBeUndefined()
  })
})

describe("wantedBy", () => {
  it("reads the destructured names of a function's first parameter", () => {
    expect(wantedBy(({ app, screen }: { app: unknown; screen: unknown }) => [app, screen])).toEqual(
      ["app", "screen"],
    )
    expect(
      wantedBy(async ({ a: renamed, b = { x: [1, 2] } }: { a: unknown; b?: unknown }) => [
        renamed,
        b,
      ]),
    ).toEqual(["a", "b"])
    expect(
      wantedBy(function named({ only }: { only: unknown }) {
        return only
      }),
    ).toEqual(["only"])
    expect(wantedBy(() => undefined)).toEqual([])
  })

  it("asks for everything when the whole object is taken", () => {
    expect(wantedBy((fixtures: unknown) => fixtures)).toBe("all")
    expect(wantedBy((_fixtures: unknown, use: unknown) => use)).toEqual([])
    expect(wantedBy(({ a, ...rest }: Record<string, unknown>) => [a, rest])).toBe("all")
    expect(wantedByAll([({ a }: { a: unknown }) => a, (all: unknown) => all])).toBe("all")
  })
})

describe("fixtureScope", () => {
  it("sets up only what is wanted, dependencies first, and tears down in reverse", async () => {
    const log: string[] = []
    const scope = fixtureScope(
      {
        base: async (_f: unknown, use: (v: string) => Promise<void>) => {
          log.push("base up")
          await use("b")
          log.push("base down")
        },
        top: async ({ base }: { base: string }, use: (v: string) => Promise<void>) => {
          log.push(`top up on ${base}`)
          await use(`${base}+t`)
          log.push("top down")
        },
        unused: async (_f: unknown, use: (v: string) => Promise<void>) => {
          log.push("unused up")
          await use("u")
        },
        constant: 42,
      },
      { builtIn: true },
    )

    await scope.prepare(["top", "builtIn"])
    expect(scope.values).toMatchObject({ builtIn: true, base: "b", top: "b+t" })
    expect(await scope.tearDown()).toEqual([])
    expect(log).toEqual(["base up", "top up on b", "top down", "base down"])
  })

  it("reports a setup that never calls use, and collects teardown errors", async () => {
    const forgetful = fixtureScope({ broken: async () => undefined }, {})

    await expect(forgetful.prepare(["broken"])).rejects.toThrow(/without calling use/)

    const failing = fixtureScope(
      {
        noisy: async (_f: unknown, use: (v: number) => Promise<void>) => {
          await use(1)
          throw new Error("teardown broke")
        },
      },
      {},
    )

    await failing.prepare("all")
    expect((await failing.tearDown()).map(String)).toEqual(["Error: teardown broke"])
  })

  it("refuses fixtures that depend on each other in a loop", async () => {
    const scope = fixtureScope(
      {
        a: async ({ b }: { b: unknown }, use: (v: unknown) => Promise<void>) => await use(b),
        b: async ({ a }: { a: unknown }, use: (v: unknown) => Promise<void>) => await use(a),
      },
      {},
    )

    await expect(scope.prepare(["a"])).rejects.toThrow(/loop: a → b → a/)
  })
})

describe("retries and discovery", () => {
  it("retries failures and timeouts, and calls a pass after a failure flaky", () => {
    expect(worthRetrying("failed")).toBe(true)
    expect(worthRetrying("timed-out")).toBe(true)
    expect(worthRetrying("skipped")).toBe(false)
    expect(resultOf([{ status: "passed" }])).toBe("passed")
    expect(resultOf([{ status: "failed" }, { status: "passed" }])).toBe("flaky")
    expect(resultOf([{ status: "failed" }, { status: "timed-out" }])).toBe("timed-out")
    expect(resultOf([])).toBe("skipped")
  })

  it("finds test files by pattern, sorted, outside node_modules", async () => {
    const dir = await mkdtemp(join(tmpdir(), "danwo-discover-"))

    try {
      await mkdir(join(dir, "b"), { recursive: true })
      await mkdir(join(dir, "node_modules", "pkg"), { recursive: true })
      await writeFile(join(dir, "b", "two.danwo.ts"), "")
      await writeFile(join(dir, "a.danwo.ts"), "")
      await writeFile(join(dir, "other.ts"), "")
      await writeFile(join(dir, "node_modules", "pkg", "x.danwo.ts"), "")

      expect(findTestFiles(dir, ["**/*.danwo.ts"])).toEqual(["a.danwo.ts", "b/two.danwo.ts"])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
