import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { GRADLE_ARGS } from "../src/build.ts"
import {
  applyIosNetworkConfig,
  applyNetworkConfig,
  buildAndroid,
  buildIos,
  NETWORK_CONFIG_NAME,
  sourceHash,
  withNetworkConfig,
  workspaceName,
  xcodebuildArgs,
} from "../src/index.ts"
import { windowsName } from "../src/slot.ts"

let project: string

beforeEach(async () => {
  project = await mkdtemp(join(tmpdir(), "danwo-expo-"))
  await writeFile(join(project, "package.json"), '{"name":"app"}')
  await writeFile(join(project, "App.tsx"), "export default function App() {}")
})

afterEach(async () => {
  await rm(project, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

describe("the danwo network config", () => {
  it("points the manifest's application at it, replacing any config already there", () => {
    const reference = `android:networkSecurityConfig="@xml/${NETWORK_CONFIG_NAME}"`

    expect(
      withNetworkConfig('<manifest><application android:label="x"></application></manifest>'),
    ).toBe(`<manifest><application ${reference} android:label="x"></application></manifest>`)
    expect(
      withNetworkConfig(
        '<application android:networkSecurityConfig="@xml/theirs" android:label="x">',
      ),
    ).toBe(`<application ${reference} android:label="x">`)
    expect(() => withNetworkConfig("<manifest/>")).toThrow("no <application> element")
  })

  it("writes the XML resource that trusts user CAs into a prebuilt project", async () => {
    const main = join(project, "android", "app", "src", "main")

    await mkdir(main, { recursive: true })
    await writeFile(
      join(main, "AndroidManifest.xml"),
      "<manifest><application></application></manifest>",
    )
    await applyNetworkConfig(join(project, "android"))

    expect(
      await readFile(join(main, "res", "xml", `${NETWORK_CONFIG_NAME}.xml`), "utf8"),
    ).toContain('<certificates src="user" />')
    expect(await readFile(join(main, "AndroidManifest.xml"), "utf8")).toContain(
      "@xml/danwo_network",
    )
  })
})

describe("the build's key", () => {
  it("changes with the app's sources, not with outputs, dependencies or dotfiles", async () => {
    const first = await sourceHash(project)

    await mkdir(join(project, "node_modules", "x"), { recursive: true })
    await writeFile(join(project, "node_modules", "x", "index.js"), "1")
    await mkdir(join(project, "android"), { recursive: true })
    await writeFile(join(project, "android", "build.gradle"), "1")
    await writeFile(join(project, ".gitignore"), "android/")
    expect(await sourceHash(project)).toBe(first)

    await writeFile(join(project, "App.tsx"), "export default function App() { return null }")
    expect(await sourceHash(project)).not.toBe(first)
  })

  it("reuses a kept build of the same sources without running the tools", async () => {
    const kept = join(project, ".danwo", "builds", `${await sourceHash(project)}.apk`)

    await mkdir(join(project, ".danwo", "builds"), { recursive: true })
    await writeFile(kept, "apk")

    const build = await buildAndroid({ project })

    expect(build).toMatchObject({ apk: kept, cached: true })
  })

  it("keeps iOS builds under their own key, and reuses one without running the tools", async () => {
    const ios = await sourceHash(project, "danwo-ios-2")

    expect(ios).not.toBe(await sourceHash(project))

    const kept = join(project, ".danwo", "builds", `${ios}.app`)

    await mkdir(kept, { recursive: true })
    expect(await buildIos({ project })).toMatchObject({ app: kept, cached: true })
  })
})

describe("the Android build", () => {
  it("runs Gradle and the Kotlin compiler in the build's own process, so no daemon outlives it", () => {
    expect(GRADLE_ARGS).toEqual([
      "assembleRelease",
      "--console=plain",
      "--no-daemon",
      "-Pkotlin.compiler.execution.strategy=in-process",
    ])
  })

  it("runs the Gradle wrapper's batch file on Windows", () => {
    expect(windowsName("./gradlew", "win32")).toBe("gradlew.bat")
    expect(windowsName("./gradlew", "linux")).toBe("./gradlew")
    expect(windowsName("npx", "win32")).toBe("npx")
  })
})

describe("the iOS build", () => {
  it("builds the prebuilt workspace's scheme for the simulator, unsigned, for this Mac's CPU", async () => {
    await mkdir(join(project, "ios", "DanwoShop.xcworkspace"), { recursive: true })

    const scheme = await workspaceName(join(project, "ios"))

    expect(scheme).toBe("DanwoShop")
    expect(xcodebuildArgs(scheme, "/dd", "arm64")).toEqual([
      "-workspace",
      "DanwoShop.xcworkspace",
      "-scheme",
      "DanwoShop",
      "-configuration",
      "Release",
      "-sdk",
      "iphonesimulator",
      "-destination",
      "generic/platform=iOS Simulator",
      "-derivedDataPath",
      "/dd",
      "ARCHS=arm64",
      "CODE_SIGNING_ALLOWED=NO",
      "COMPILER_INDEX_STORE_ENABLE=NO",
    ])
    expect(xcodebuildArgs(scheme, "/dd", "x64")).toContain("ARCHS=x86_64")
    await expect(workspaceName(project)).rejects.toThrow("no Xcode workspace")
  })

  /* It edits the plist with `plutil`, which only macOS has. */
  it.skipIf(process.platform !== "darwin")(
    "lets the danwo build make plain HTTP calls, with no finer key that would switch it off",
    async () => {
      const plist = join(project, "Info.plist")

      await writeFile(
        plist,
        '<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict><key>NSAppTransportSecurity</key><dict><key>NSAllowsLocalNetworking</key><true/></dict></dict></plist>',
      )
      await applyIosNetworkConfig(plist)

      const text = await readFile(plist, "utf8")

      expect(text).toContain("<key>NSAllowsArbitraryLoads</key>")
      expect(text).not.toContain("NSAllowsLocalNetworking")
    },
  )
})
