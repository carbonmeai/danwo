/**
 * The mobile shop on a real Android emulator: build (or reuse) its APK, run its test, then the
 * fault matrix for a careful app and for one that grants a duplicated webhook twice. Runs only when
 * asked (`DANWO_ANDROID=1`) on a machine with the Android SDK and the AVD (`DANWO_AVD`, default
 * `danwo_spike`); otherwise it skips at once.
 */
import { execFile } from "node:child_process"
import { existsSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

import { androidSdkRoot } from "@danwo/device/toolchain"
import { describe, expect, it } from "vitest"

const BIN = fileURLToPath(new URL("../src/bin.ts", import.meta.url))
const SHOP = fileURLToPath(new URL("../../../examples/shop-mobile", import.meta.url))
const TEST = "tests/buy-credits.danwo.ts"
const AVD = process.env.DANWO_AVD ?? "danwo_spike"
/** A build, a boot and a matrix of about thirty trials on one emulator take minutes. */
const LONG = 1_800_000

/* A matrix's own SHOP_BUG decides which app runs; one left in the environment would not. */
delete process.env.SHOP_BUG

const ready =
  process.env.DANWO_ANDROID === "1" &&
  androidSdkRoot() !== undefined &&
  existsSync(join(homedir(), ".android", "avd", `${AVD}.avd`))

/** Runs `danwo <args>` in the mobile shop, with `bug` set; resolves to exit code and output. */
function danwo(args: readonly string[], bug?: string): Promise<{ code: number; out: string }> {
  const env = { ...process.env, NO_COLOR: "1", ...(bug !== undefined && { SHOP_BUG: bug }) }

  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [BIN, ...args],
      { cwd: SHOP, env, maxBuffer: 64 * 1024 * 1024 },
      (error, stdout, stderr) => {
        const code = error === null ? 0 : typeof error.code === "number" ? error.code : 1

        resolve({ code, out: `${stdout}${stderr}` })
      },
    )
  })
}

describe.skipIf(!ready)("an Expo app on an Android emulator", () => {
  it(
    "builds the danwo APK, or reuses the one kept for the same sources",
    { timeout: LONG },
    async () => {
      const { code, out } = await danwo(["build-android", "app"])

      expect(out).toMatch(/^(built|reused) .*\.apk/m)
      expect(code).toBe(0)
    },
  )

  it("buys credits through Stripe Checkout in a Custom Tab", { timeout: LONG }, async () => {
    const { code, out } = await danwo(["test"])

    expect(out).toContain("1 passed")
    expect(code).toBe(0)
  })

  it("passes every judged fault for a careful app", { timeout: LONG }, async () => {
    const { code, out } = await danwo(["matrix", TEST])

    expect(out).toContain("PASS  clean run")
    expect(out).toContain("PASS  duplicate on stripe webhook checkout.session.completed")
    expect(out).not.toMatch(/^FAIL /m)
    expect([0, 3]).toContain(code)
  })

  it(
    "fails only the duplicated checkout.session.completed when the app does not dedupe",
    { timeout: LONG },
    async () => {
      const { code, out } = await danwo(["matrix", TEST], "no-dedupe")
      const failed = out.split("\n").filter((line) => line.startsWith("FAIL "))

      expect(failed).toEqual(["FAIL  duplicate on stripe webhook checkout.session.completed"])
      expect(out).toContain("invariant: expected 1000 to be 500")
      /* 1 for the failed run; 3 when an emulator hiccup also left a run unjudged. */
      expect([1, 3]).toContain(code)
    },
  )
})
