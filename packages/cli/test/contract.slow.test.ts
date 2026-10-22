/*
 * Contract: what `danwo test` does with a test file, seen from outside: hook and fixture order,
 * invariants, skips, `only`, per-test timeouts and retries, exit codes, and where a failure's
 * record goes. The fixture tests append to a log in a temporary state directory.
 */
import { execFile } from "node:child_process"
import { existsSync } from "node:fs"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest"

import { removeWorkCopies, workCopy } from "./work-copy.ts"

const BIN = fileURLToPath(new URL("../src/bin.ts", import.meta.url))
const FIXTURE = workCopy(fileURLToPath(new URL("./fixtures/contract", import.meta.url)))

let state: string

beforeEach(async () => {
  state = await mkdtemp(join(tmpdir(), "danwo-contract-"))
})

afterEach(async () => {
  await rm(state, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

afterAll(removeWorkCopies)

/** Runs `danwo test <file>` in the fixture; resolves to its exit code, output and the run log. */
function danwoTest(file: string): Promise<{ code: number; out: string; log: string[] }> {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [BIN, "test", `tests/${file}`],
      { cwd: FIXTURE, env: { ...process.env, NO_COLOR: "1", DANWO_FIXTURE_STATE: state } },
      (error, stdout, stderr) => {
        const code = error === null ? 0 : typeof error.code === "number" ? error.code : 1
        const logFile = join(state, "run.log")

        void (existsSync(logFile) ? readFile(logFile, "utf8") : Promise.resolve("")).then((log) =>
          resolve({ code, out: `${stdout}${stderr}`, log: log.split("\n").filter(Boolean) }),
        )
      },
    )
  })
}

/** Asserts `lines` appear in `log` in this order (other lines may come between). */
function expectInOrder(log: readonly string[], lines: readonly string[]): void {
  const positions = lines.map((line) => log.indexOf(line))

  expect(
    positions,
    `missing one of ${JSON.stringify(lines)} in ${JSON.stringify(log)}`,
  ).not.toContain(-1)
  expect(positions).toEqual(positions.toSorted((a, b) => a - b))
}

describe("hooks, fixtures and invariants", () => {
  it("runs suite hooks once around the file and beforeEach hooks outermost first", async () => {
    const { code, out, log } = await danwoTest("hooks.danwo.ts")

    expect(out).toContain("2 passed")
    expect(code).toBe(0)
    expect(log[0]).toBe("beforeAll")
    expect(log.at(-1)).toBe("afterAll")
    expectInOrder(log, [
      "beforeEach outer",
      "beforeEach inner",
      "body uses a fixture: ready",
      "invariant: ready",
      "afterEach inner",
      "fixture teardown",
      "body runs second",
    ])
    expectInOrder(log, ["fixture setup", "body uses a fixture: ready"])
    expectInOrder(log, ["invariant: ready", "afterEach outer", "fixture teardown"])
  }, 120_000)

  it("runs afterEach hooks innermost first and sets up a fixture only for tests that use it", async () => {
    const { log } = await danwoTest("hooks.danwo.ts")
    const second = log.indexOf("body runs second")

    expectInOrder(log, ["invariant: ready", "afterEach inner", "afterEach outer"])
    expect(log.slice(second).slice(0, 3)).toEqual([
      "body runs second",
      "afterEach inner",
      "afterEach outer",
    ])
    expect(log.filter((line) => line === "fixture setup")).toHaveLength(1)
  }, 120_000)

  it("fails a test whose body fails, prints why, and does not run its invariant", async () => {
    const { code, out, log } = await danwoTest("body-fails.danwo.ts")

    expect(out).toContain("tests/body-fails.danwo.ts › fails in its body")
    expect(out).toContain("expected 'body' to be 'passing'")
    expect(out).toContain("1 failed")
    expect(out).toMatch(/record: \.danwo\/runs\//)
    expect(log).toEqual(["body that fails"])
    expect(code).toBe(1)
  }, 120_000)
})

describe("selecting tests", () => {
  it("skips by declaration, by option and at runtime, without running past the skip", async () => {
    const { code, out, log } = await danwoTest("skip.danwo.ts")

    expect(out).toContain("3 skipped")
    expect(log).toEqual([])
    expect(code).toBe(0)
  }, 120_000)

  it("runs only the test marked only", async () => {
    const { code, out, log } = await danwoTest("only.danwo.ts")

    expect(out).toContain("Running 1 test")
    expect(out).toContain("1 passed")
    expect(log).toEqual(["ran the only test"])
    expect(code).toBe(0)
  }, 120_000)
})

describe("timeouts and retries", () => {
  it("fails a test that runs past its own timeout", async () => {
    const { code, out } = await danwoTest("timeout.danwo.ts")

    expect(out).toContain("tests/timeout.danwo.ts › runs past its own timeout")
    expect(out).toMatch(/timed out after 1000 ms/)
    expect(code).toBe(1)
  }, 120_000)

  it("retries a test up to its own retry count and reports it as flaky when a retry passes", async () => {
    const { code, out, log } = await danwoTest("retries.danwo.ts")

    expect(out).toContain("(3 attempts)")
    expect(out).toContain("1 flaky")
    expect(log).toEqual(["retries attempt 1", "retries attempt 2", "retries attempt 3"])
    expect(code).toBe(0)
  }, 120_000)
})
