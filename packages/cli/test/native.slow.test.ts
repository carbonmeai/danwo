/**
 * Native apps on real devices: the SwiftUI example on an iOS Simulator (`DANWO_IOS=1`, a Mac with
 * Xcode) and the Jetpack Compose example on an Android emulator (`DANWO_ANDROID=1`, the SDK and the
 * AVD `DANWO_AVD`, default `danwo_spike`). Each builds its native project from cold in a work copy
 * and then reuses the build; with the example installed (its `node_modules`, from
 * `node examples/link.ts <example> --here`), it also runs the example's tests and a short fault
 * matrix. Otherwise it skips at once. The simulator is this run's own and is deleted at the end.
 */
import { execFile, execFileSync } from "node:child_process"
import { existsSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

import { androidSdkRoot } from "@danwo/device/toolchain"
import { afterAll, describe, expect, it } from "vitest"

import { removeWorkCopies, workCopy } from "./work-copy.ts"

const BIN = fileURLToPath(new URL("../src/bin.ts", import.meta.url))
const SWIFTUI = fileURLToPath(new URL("../../../examples/with-swiftui", import.meta.url))
const COMPOSE = fileURLToPath(new URL("../../../examples/with-compose", import.meta.url))
const AVD = process.env.DANWO_AVD ?? "danwo_spike"
/** This run's own simulator, so no other run's device is touched. */
const SIMULATOR = `danwo native iPhone ${process.pid}`
/** A cold build, a boot and a matrix of about twenty trials take minutes. */
const LONG = 1_800_000

/** Whether this Mac has Xcode with simctl (the command-line tools alone have no Simulator). */
function hasXcode(): boolean {
  if (process.platform !== "darwin") return false

  try {
    return execFileSync("xcode-select", ["-p"], { encoding: "utf8" }).includes(".app/")
  } catch {
    return false
  }
}

const iosReady = process.env.DANWO_IOS === "1" && hasXcode()
const androidReady =
  process.env.DANWO_ANDROID === "1" &&
  androidSdkRoot() !== undefined &&
  existsSync(join(homedir(), ".android", "avd", `${AVD}.avd`))

/** Whether the example has its packages installed, which its tests need. */
const installed = (example: string) => existsSync(join(example, "node_modules", "@danwo", "sdk"))

/** Runs `danwo <args>` in a work copy of `example`; exit code and output. */
function danwo(example: string, args: readonly string[]): Promise<{ code: number; out: string }> {
  const env = { ...process.env, NO_COLOR: "1", DANWO_IOS_SIMULATOR: SIMULATOR }

  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [BIN, ...args],
      { cwd: workCopy(example), env, maxBuffer: 64 * 1024 * 1024 },
      (error, stdout, stderr) => {
        const code = error === null ? 0 : typeof error.code === "number" ? error.code : 1

        resolve({ code, out: `${stdout}${stderr}` })
      },
    )
  })
}

afterAll(() => {
  removeWorkCopies()

  /* The simulator was made for this run alone. */
  if (iosReady) {
    try {
      execFileSync("xcrun", ["simctl", "delete", SIMULATOR], { stdio: "ignore" })
    } catch {
      /* None was made: the tests did not get that far. */
    }
  }
})

describe.skipIf(!iosReady)("a SwiftUI app on an iOS Simulator", () => {
  it(
    "builds the Xcode project for the simulator, then reuses the build",
    { timeout: LONG },
    async () => {
      const built = await danwo(SWIFTUI, ["build-ios", "ios", "--force"])

      expect(built.out).toMatch(/^built .*\.app \(dev\.danwo\.examples\.swiftui\) in/m)
      expect(built.code).toBe(0)

      const reused = await danwo(SWIFTUI, ["build-ios", "ios"])

      expect(reused.out).toMatch(/^reused .*\.app \(dev\.danwo\.examples\.swiftui\)$/m)
    },
  )

  it.skipIf(!installed(SWIFTUI))(
    "joins the waitlist through the proxy, with no change to the app, under the fault matrix",
    { timeout: LONG },
    async () => {
      const tests = await danwo(SWIFTUI, ["test", "--workers", "1"])

      /* The agent's test skips without a model key. */
      expect(tests.out).toMatch(/3 passed/)
      expect(tests.code).toBe(0)

      const matrix = await danwo(SWIFTUI, [
        "matrix",
        "tests/deterministic.danwo.ts",
        "--grep",
        "joins the waitlist",
        "--budget",
        "8",
      ])

      expect(matrix.out).toContain("PASS  clean run")
      expect(matrix.out).not.toContain("FAIL ")
      expect(matrix.code).toBe(0)
    },
  )
})

describe.skipIf(!androidReady)("a Jetpack Compose app on an Android emulator", () => {
  it(
    "builds the Gradle project as a signed APK, then reuses the build",
    { timeout: LONG },
    async () => {
      const built = await danwo(COMPOSE, ["build-android", "android", "--force"])

      expect(built.out).toMatch(/^built .*\.apk \(dev\.danwo\.examples\.compose\) in/m)
      expect(built.code).toBe(0)

      const reused = await danwo(COMPOSE, ["build-android", "android"])

      expect(reused.out).toMatch(/^reused .*\.apk \(dev\.danwo\.examples\.compose\)$/m)
    },
  )

  it.skipIf(!installed(COMPOSE))(
    "joins the waitlist through the proxy, with danwo's network config added to the build, under the fault matrix",
    { timeout: LONG },
    async () => {
      const tests = await danwo(COMPOSE, ["test", "--workers", "1"])

      expect(tests.out).toMatch(/3 passed/)
      expect(tests.code).toBe(0)

      const matrix = await danwo(COMPOSE, [
        "matrix",
        "tests/deterministic.danwo.ts",
        "--grep",
        "joins the waitlist",
        "--budget",
        "8",
      ])

      expect(matrix.out).toContain("PASS  clean run")
      expect(matrix.out).not.toContain("FAIL ")
      expect(matrix.code).toBe(0)
    },
  )
})
