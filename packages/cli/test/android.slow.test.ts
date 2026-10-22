/**
 * The mobile shop on a real Android emulator: build (or reuse) its APK, run its tests, record its
 * agent steps with a scripted model and replay them with none, then the fault matrix for a careful
 * app (on two emulators for the agent's test) and for one that grants a duplicated webhook twice,
 * and last the device's gestures: swipes for a duration, a long press and the keyboard put away.
 * Runs only when asked (`DANWO_ANDROID=1`) on a machine with the Android SDK and the AVD
 * (`DANWO_AVD`, default `danwo_spike`; `DANWO_AVD_SNAPSHOT` boots from a saved snapshot);
 * otherwise it skips at once.
 */
import { execFile } from "node:child_process"
import { existsSync } from "node:fs"
import { copyFile, mkdtemp, rm } from "node:fs/promises"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

import { androidSdkRoot } from "@danwo/mobile/toolchain"
import { afterAll, describe, expect, it } from "vitest"

import { removeWorkCopies, workCopy } from "./work-copy.ts"

const BIN = fileURLToPath(new URL("../src/bin.ts", import.meta.url))
const SOURCE = fileURLToPath(new URL("../../../examples/shop-mobile", import.meta.url))
const TEST = "tests/buy-credits.danwo.ts"
const AGENT_TEST = "tests/agent-buy.danwo.ts"
/** A test of the device's gestures, copied into the shop for the last run. */
const GESTURES = fileURLToPath(new URL("./fixtures/device-gestures.danwo.ts", import.meta.url))
const AVD = process.env.DANWO_AVD ?? "danwo_spike"
/** A build, a boot and a matrix of about thirty trials on one emulator take minutes. */
const LONG = 1_800_000

/* A matrix's own SHOP_BUG decides which app runs; one left in the environment would not. */
delete process.env.SHOP_BUG

const ready =
  process.env.DANWO_ANDROID === "1" &&
  androidSdkRoot() !== undefined &&
  existsSync(join(homedir(), ".android", "avd", `${AVD}.avd`))

/** Runs `danwo <args>` in the mobile shop with `extra` in its environment; exit code and output. */
function danwo(
  args: readonly string[],
  extra: Readonly<Record<string, string>> = {},
): Promise<{ code: number; out: string }> {
  const env = { ...process.env, NO_COLOR: "1", ...extra }

  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [BIN, ...args],
      { cwd: workCopy(SOURCE), env, maxBuffer: 64 * 1024 * 1024 },
      (error, stdout, stderr) => {
        const code = error === null ? 0 : typeof error.code === "number" ? error.code : 1

        resolve({ code, out: `${stdout}${stderr}` })
      },
    )
  })
}

// Every run writes into the fixture's copy; the copies go when the file is done.
afterAll(removeWorkCopies)

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

    /* The agent's test replays its committed recordings: no model is asked. */
    expect(out).toContain("2 passed")
    expect(out).toContain("cache: 3 replayed")
    expect(out).not.toMatch(/^model: /m)
    expect(code).toBe(0)
  })

  it(
    "records agent steps with a model, then replays them with none",
    { timeout: LONG },
    async () => {
      const dir = await mkdtemp(join(tmpdir(), "danwo-android-cache-"))

      try {
        const recorded = await danwo(["test", AGENT_TEST], {
          DANWO_MODEL: "scripted",
          DANWO_CACHE_DIR: dir,
        })

        expect(recorded.out).toContain("0 replayed · 0 relocated · 0 handed off · 3 missed")
        expect(recorded.out).toMatch(/^model: 6 calls/m)
        expect(recorded.code).toBe(0)

        const replayed = await danwo(["test", AGENT_TEST, "--ci"], { DANWO_CACHE_DIR: dir })

        expect(replayed.out).toContain("cache: 3 replayed")
        expect(replayed.out).not.toMatch(/^model: /m)
        expect(replayed.code).toBe(0)
      } finally {
        await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
      }
    },
  )

  it(
    "runs the agent's test's matrix on two emulators with no model call",
    { timeout: LONG },
    async () => {
      const { code, out } = await danwo(["matrix", AGENT_TEST, "--workers", "2"])

      expect(out).toContain("PASS  clean run")
      expect(out).not.toMatch(/^FAIL /m)
      expect(out).toContain("0 handed off · 0 missed")
      expect(out).not.toMatch(/^model: /m)
      expect([0, 3]).toContain(code)
    },
  )

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
      const { code, out } = await danwo(["matrix", TEST], { SHOP_BUG: "no-dedupe" })
      const failed = out.split("\n").filter((line) => line.startsWith("FAIL "))

      expect(failed).toEqual(["FAIL  duplicate on stripe webhook checkout.session.completed"])
      expect(out).toContain("invariant: expected 1000 to be 500")
      /* 1 for the failed run; 3 when an emulator hiccup also left a run unjudged. */
      expect([1, 3]).toContain(code)
    },
  )

  it(
    "swipes for a duration, long-presses and puts the keyboard away",
    { timeout: LONG },
    async () => {
      await copyFile(GESTURES, join(workCopy(SOURCE), "tests", "gestures.danwo.ts"))

      const { code, out } = await danwo(["test", "tests/gestures.danwo.ts"])

      expect(out).toContain("1 passed")
      expect(code).toBe(0)
    },
  )
})
