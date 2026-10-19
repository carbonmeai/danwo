import { createServer } from "node:net"

import { describe, expect, it, vi } from "vitest"

import { startApp } from "../src/runner/app-environment.ts"
import { appsDownNotes, appsDownSince, withAppsDown } from "../src/runner/apps-down.ts"
import type { WorkerEnvironment } from "../src/runner/environment.ts"
import type { TestError } from "../src/support/errors.ts"

/** A port nothing listens on. */
function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const probe = createServer().listen(0, "127.0.0.1", () => {
      const address = probe.address()

      probe.close(() => resolve(typeof address === "object" && address ? address.port : 0))
    })
  })
}

/** A server that answers, then exits with `code` after `ms`. */
async function shortLivedApp(code: number, ms: number) {
  const port = await freePort()
  const script = `require("http").createServer((q, s) => s.end("ok")).listen(${port}, "127.0.0.1", () => setTimeout(() => process.exit(${code}), ${ms}))`

  return {
    command: `"${process.execPath}" -e '${script}'`,
    url: `http://127.0.0.1:${port}`,
    timeoutMs: 10_000,
  }
}

const failure: TestError = {
  code: "EXPECTATION_FAILED",
  class: "test",
  name: "AssertionError",
  message: "expected the dashboard to load",
}

describe("apps that go down during a test", () => {
  it("knows an app stopped on its own, and not when danwo stopped it", async () => {
    const crashing = await startApp(await shortLivedApp(4, 1_500))

    await vi.waitFor(() => expect(crashing.exited()).toBe("exited with code 4"), { timeout: 5_000 })
    await crashing.stop()

    const steady = await startApp(await shortLivedApp(0, 60_000))

    await steady.stop()
    expect(steady.exited()).toBeUndefined()
  }, 20_000)

  it("names only the apps that went down since the test began", () => {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- only stopped() is read
    const env = {
      stopped: () => ["worker exited with code 2", "api exited with code 1"],
    } as unknown as WorkerEnvironment

    expect(appsDownSince(env, ["worker exited with code 2"])).toEqual(["api exited with code 1"])
    expect(appsDownSince(undefined, [])).toEqual([])
  })

  it("adds them to the test's error and to the record's notes", () => {
    expect(withAppsDown(failure, ["api exited with code 1"])?.message).toBe(
      "expected the dashboard to load\n(api exited with code 1 during this test)",
    )
    expect(withAppsDown(failure, [])).toBe(failure)
    expect(withAppsDown(undefined, ["api exited with code 1"])).toBeUndefined()
    expect(appsDownNotes(["api exited with code 1"])).toEqual([
      "api exited with code 1 during this test; its last output is in this record",
    ])
  })
})
