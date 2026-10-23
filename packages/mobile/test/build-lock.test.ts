import { existsSync } from "node:fs"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { buildAndroid, buildIos } from "../src/build/index.ts"
import { type LockSystem, withBuildLock } from "../src/build/lock.ts"
import type { BuildExec } from "../src/build/slot.ts"

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "danwo-build-lock-"))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

/** Writes `entries` (path to contents) under `root`. */
async function files(root: string, entries: Readonly<Record<string, string>>): Promise<void> {
  for (const [path, text] of Object.entries(entries)) {
    await mkdir(dirname(join(root, path)), { recursive: true })
    await writeFile(join(root, path), text)
  }
}

/** A pause long enough for a second caller to arrive while the first is building. */
const pause = () => new Promise((resolve) => setTimeout(resolve, 300))

/** A system whose clock moves only as it sleeps, with the processes in `running` alive. */
function fakeSystem(running: readonly number[]): LockSystem & { readonly slept: number[] } {
  let now = 1_000_000
  const slept: number[] = []

  return {
    pid: 1,
    alive: (pid) => running.includes(pid),
    now: () => now,
    sleep: async (ms) => {
      slept.push(ms)
      now += ms
    },
    slept,
  }
}

/** A lock file as a build of `pid` writes it. */
async function lockOf(file: string, pid: number): Promise<void> {
  await files(dirname(file), {
    [file.split(/[\\/]/).at(-1) ?? ""]: JSON.stringify({ pid, token: "t", since: 0 }),
  })
}

describe("one build of a project at a time", () => {
  it("builds an Xcode project once for two workers at once, and hands both the same app", async () => {
    await files(dir, { "Hello.xcodeproj/project.pbxproj": "", "Hello/App.swift": "@main" })

    const builds: string[] = []

    const exec: BuildExec = async (command, args) => {
      if (args.includes("-list")) return '{"project":{"schemes":["Hello"]}}'

      if (command === "xcodebuild") {
        builds.push(args.join(" "))
        await pause()
        await files(join(dir, ".danwo", "xcode", "Build", "Products", "Release-iphonesimulator"), {
          "Hello.app/Info.plist": "<plist/>",
        })
      }

      return args[0] === "-extract" ? "dev.danwo.hello\n" : ""
    }

    const options = { project: dir, exec, env: {} }
    const [first, second] = await Promise.all([buildIos(options), buildIos(options)])

    expect(builds).toHaveLength(1)
    expect(second?.app).toBe(first?.app)
    /* One built it; the other waited and found it kept. */
    expect([first?.cached, second?.cached].filter(Boolean)).toHaveLength(1)
    expect(existsSync(join(dir, ".danwo", "builds", "build-ios.lock"))).toBe(false)
  })

  it("builds a Gradle project once for two workers at once, and hands both the same APK", async () => {
    await files(dir, {
      "sdk/build-tools/36.1.0/aapt2": "",
      "app/settings.gradle.kts": "",
      "app/gradlew": "",
      "app/app/src/Main.kt": "",
    })

    const project = join(dir, "app")
    const env = { ANDROID_HOME: join(dir, "sdk"), JAVA_HOME: join(dir, "jdk") }
    let gradle = 0

    const exec: BuildExec = async (command) => {
      if (command === "./gradlew") {
        gradle += 1
        await pause()
        await files(project, { "app/build/outputs/apk/debug/app-debug.apk": "debug" })
      }

      return command.endsWith("aapt2") ? "dev.danwo.hello\n" : ""
    }

    const options = { project, variant: "debug", env, exec }
    const [first, second] = await Promise.all([buildAndroid(options), buildAndroid(options)])

    expect(gradle).toBe(1)
    expect(second?.apk).toBe(first?.apk)
    expect(await readFile(first?.apk ?? "", "utf8")).toBe("debug")
    /* One built it; the other waited and found it kept. */
    expect([first?.cached, second?.cached].filter(Boolean)).toHaveLength(1)
  })

  it("breaks a lock left by a build whose process has died", async () => {
    const file = join(dir, "build-ios.lock")
    const system = fakeSystem([])

    await lockOf(file, 4242)

    expect(await withBuildLock(file, async () => "built", { system })).toBe("built")
    expect(system.slept).toEqual([])
    expect(existsSync(file)).toBe(false)
  })

  it("waits for a running build, then fails after the timeout naming it and the lock", async () => {
    const file = join(dir, "build-ios.lock")
    const system = fakeSystem([4242])
    const waits: string[] = []
    let ran = false

    await lockOf(file, 4242)

    await expect(
      withBuildLock(
        file,
        async () => {
          ran = true
        },
        { system, timeoutMs: 2000, onWait: (holder) => waits.push(holder) },
      ),
    ).rejects.toThrow(
      `waited 2 s for the build of pid 4242, running since 1970-01-01T00:00:00.000Z to finish building; if no build is running, delete ${file}`,
    )
    expect(ran).toBe(false)
    expect(waits).toHaveLength(1)
    /* Someone else's lock is left as it was. */
    expect(JSON.parse(await readFile(file, "utf8"))).toMatchObject({ pid: 4242 })
  })

  it("releases the lock when the build fails", async () => {
    const file = join(dir, "build-android.lock")

    await expect(
      withBuildLock(file, async () => {
        throw new Error("gradle failed")
      }),
    ).rejects.toThrow("gradle failed")
    expect(existsSync(file)).toBe(false)
  })
})
