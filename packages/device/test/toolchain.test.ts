import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterAll, describe, expect, it } from "vitest"

import { androidTools, defaultSdkDirs, javaHome } from "../src/toolchain.ts"

const dir = mkdtempSync(join(tmpdir(), "danwo-toolchain-"))

afterAll(() => rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))

describe("the Android tools on each platform", () => {
  it("looks where Android Studio puts the SDK on Windows", () => {
    expect(defaultSdkDirs("win32", { LOCALAPPDATA: join(dir, "Local") })).toEqual([
      join(dir, "Local", "Android", "Sdk"),
    ])
    expect(defaultSdkDirs("darwin", {})[0]).toMatch(/Library[\\/]Android[\\/]sdk$/)
  })

  it("names adb and the emulator with .exe on Windows only", () => {
    const windows = androidTools({ ANDROID_HOME: dir }, "win32")
    const linux = androidTools({ ANDROID_HOME: dir }, "linux")

    expect(windows.adb).toBe(join(dir, "platform-tools", "adb.exe"))
    expect(windows.emulator).toBe(join(dir, "emulator", "emulator.exe"))
    expect(linux.adb).toBe(join(dir, "platform-tools", "adb"))
  })

  it("finds a JDK by java.exe on Windows", () => {
    const jdk = join(dir, "jdk")

    mkdirSync(join(jdk, "bin"), { recursive: true })
    writeFileSync(join(jdk, "bin", "java.exe"), "")

    expect(javaHome({ JAVA_HOME: jdk, ProgramFiles: dir }, "win32")).toBe(jdk)
    expect(javaHome({ JAVA_HOME: jdk }, "linux")).toBeUndefined()
  })
})
