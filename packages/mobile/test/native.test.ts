import { existsSync } from "node:fs"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

import { afterEach, beforeEach, describe, expect, it } from "vitest"

import {
  FLUTTER_ARGS,
  buildFlutterAndroid,
  buildFlutterIos,
  flutterAndroidEnv,
} from "../src/build/flutter.ts"
import {
  buildGradle,
  gradleArgs,
  NETWORK_MANIFEST,
  networkInitScript,
} from "../src/build/gradle.ts"
import {
  androidProject,
  buildAndroid,
  buildIos,
  iosProject,
  sourceHash,
} from "../src/build/index.ts"
import type { BuildExec } from "../src/build/slot.ts"
import {
  buildXcode,
  interfaceBuilderDaemons,
  nativeXcodebuildArgs,
  pickScheme,
  schemesOf,
  XCODE_OUTPUTS,
} from "../src/build/xcode.ts"

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "danwo-native-"))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

/** Writes `files` (path to contents) under `root`. */
async function files(root: string, entries: Readonly<Record<string, string>>): Promise<void> {
  for (const [path, text] of Object.entries(entries)) {
    await mkdir(dirname(join(root, path)), { recursive: true })
    await writeFile(join(root, path), text)
  }
}

/** One call the build made: the tool, its arguments and where it ran. */
interface Call {
  readonly command: string
  readonly args: readonly string[]
  readonly cwd: string
}

/** A fake `exec` that records each call and answers through `answer`. */
function fakeExec(answer: (call: Call) => Promise<string> | string = () => ""): {
  readonly exec: BuildExec
  readonly calls: Call[]
} {
  const calls: Call[] = []

  return {
    calls,
    exec: async (command, args, { cwd }) => {
      const call = { command, args, cwd }

      calls.push(call)

      return answer(call)
    },
  }
}

/** The tool each call ran, by its file name, with its first argument: `xcodebuild -list`. */
function steps(calls: readonly Call[]): string[] {
  return calls.map(({ command, args }) => `${command.split(/[\\/]/).at(-1) ?? ""} ${args[0] ?? ""}`)
}

describe("finding what kind of app a folder holds", () => {
  it("tells a Flutter app, an Xcode workspace or project, and an Expo app apart for iOS", async () => {
    await files(dir, {
      "flutter/pubspec.yaml": "name: app",
      "flutter/ios/Runner.xcodeproj/project.pbxproj": "",
      "both/Hello.xcodeproj/project.pbxproj": "",
      "both/Hello.xcworkspace/contents.xcworkspacedata": "",
      "project/Hello.xcodeproj/project.pbxproj": "",
      "expo/package.json": "{}",
      "empty/README.md": "",
    })

    expect(await iosProject(join(dir, "flutter"))).toEqual({ kind: "flutter" })
    /* A workspace wins: a project with CocoaPods builds only through it. */
    expect(await iosProject(join(dir, "both"))).toEqual({
      kind: "xcode",
      container: { kind: "workspace", file: "Hello.xcworkspace", name: "Hello" },
    })
    expect(await iosProject(join(dir, "project"))).toEqual({
      kind: "xcode",
      container: { kind: "project", file: "Hello.xcodeproj", name: "Hello" },
    })
    expect(await iosProject(join(dir, "expo"))).toEqual({ kind: "expo" })
    await expect(iosProject(join(dir, "empty"))).rejects.toThrow("no app to build for iOS")
  })

  it("tells a Flutter app, a Gradle project and an Expo app apart for Android", async () => {
    await files(dir, {
      "flutter/pubspec.yaml": "name: app",
      "flutter/android/settings.gradle.kts": "",
      "gradle/settings.gradle.kts": "",
      "gradle/gradlew": "",
      "groovy/settings.gradle": "",
      "groovy/gradlew": "",
      "nowrapper/settings.gradle.kts": "",
      "expo/package.json": "{}",
      "empty/README.md": "",
    })

    expect(androidProject(join(dir, "flutter"))).toEqual({ kind: "flutter" })
    expect(androidProject(join(dir, "gradle"))).toEqual({ kind: "gradle" })
    expect(androidProject(join(dir, "groovy"))).toEqual({ kind: "gradle" })
    expect(() => androidProject(join(dir, "nowrapper"))).toThrow("without its wrapper")
    expect(androidProject(join(dir, "expo"))).toEqual({ kind: "expo" })
    expect(() => androidProject(join(dir, "empty"))).toThrow("no app to build for Android")
  })
})

describe("the native iOS build", () => {
  const project = { kind: "project", file: "Hello.xcodeproj", name: "Hello" } as const

  it("reads the schemes of a project or a workspace, and picks the one to build", () => {
    expect(schemesOf('{"project":{"name":"Hello","schemes":["Hello","HelloTests"]}}')).toEqual([
      "Hello",
      "HelloTests",
    ])
    expect(schemesOf('{"workspace":{"name":"Hello","schemes":["Hello","Pods-Hello"]}}')).toEqual([
      "Hello",
      "Pods-Hello",
    ])

    expect(pickScheme(["Only"], project)).toBe("Only")
    expect(pickScheme(["Hello", "HelloTests"], project)).toBe("Hello")
    expect(pickScheme(["Hello", "Other"], project, "Other")).toBe("Other")
    expect(() => pickScheme(["A", "B"], project)).toThrow("several schemes (A, B): pass --scheme")
    expect(() => pickScheme([], project)).toThrow("no shared scheme")
    expect(() => pickScheme(["Hello"], project, "Nope")).toThrow("has no scheme Nope")
  })

  it("builds the scheme for the simulator, unsigned, for this Mac's CPU", () => {
    expect(
      nativeXcodebuildArgs({
        container: project,
        scheme: "Hello",
        configuration: "Release",
        derivedData: "/dd",
        arch: "arm64",
      }),
    ).toEqual([
      "-project",
      "Hello.xcodeproj",
      "-scheme",
      "Hello",
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
      "build",
    ])
    expect(
      nativeXcodebuildArgs({
        container: { kind: "workspace", file: "Hello.xcworkspace", name: "Hello" },
        scheme: "Hello",
        configuration: "Debug",
        derivedData: "/dd",
        arch: "x64",
      }),
    ).toEqual(expect.arrayContaining(["-workspace", "Hello.xcworkspace", "Debug", "ARCHS=x86_64"]))
  })

  it("builds, opens App Transport Security in the kept app, reads its bundle id, then reuses it", async () => {
    await files(dir, { "Hello.xcodeproj/project.pbxproj": "", "Hello/App.swift": "@main" })

    const fake = fakeExec(async ({ command, args }) => {
      if (args.includes("-list")) return '{"project":{"schemes":["Hello"]}}'

      if (command === "xcodebuild") {
        const products = join(
          dir,
          ".danwo",
          "xcode",
          "Build",
          "Products",
          "Release-iphonesimulator",
        )

        await files(products, { "Hello.app/Info.plist": "<plist/>" })
      }

      return args[0] === "-extract" ? "dev.danwo.hello\n" : ""
    })
    /* An environment of its own, so the test runs where there is no Xcode too. */
    const options = { project: dir, container: project, exec: fake.exec, env: {} }
    const built = await buildXcode(options)

    expect(built).toMatchObject({ cached: false, bundleId: "dev.danwo.hello" })
    expect(built.app).toMatch(/\.danwo\/builds\/[0-9a-f]{16}\.app$/)
    expect(existsSync(join(built.app, "Info.plist"))).toBe(true)
    expect(steps(fake.calls)).toEqual([
      "xcodebuild -list",
      "xcodebuild -project",
      "plutil -replace",
      "plutil -extract",
    ])
    expect(fake.calls[2]?.args).toEqual([
      "-replace",
      "NSAppTransportSecurity",
      "-json",
      '{"NSAllowsArbitraryLoads":true}',
      join(built.app, "Info.plist"),
    ])

    fake.calls.length = 0

    expect(await buildXcode(options)).toMatchObject({ app: built.app, cached: true })
    expect(steps(fake.calls)).toEqual(["plutil -extract"])
  })

  it("installs a workspace's pods first when they are missing", async () => {
    await files(dir, { "Hello.xcworkspace/contents.xcworkspacedata": "", Podfile: "" })

    const fake = fakeExec(async ({ command, args }) => {
      if (args.includes("-list")) return '{"workspace":{"schemes":["Hello","Pods-Hello"]}}'
      if (command === "xcodebuild")
        await files(join(dir, ".danwo", "xcode", "Build", "Products", "Release-iphonesimulator"), {
          "Hello.app/Info.plist": "",
        })

      return ""
    })

    await buildXcode({
      project: dir,
      container: { kind: "workspace", file: "Hello.xcworkspace", name: "Hello" },
      exec: fake.exec,
      env: {},
    })

    expect(steps(fake.calls).slice(0, 3)).toEqual([
      "pod install",
      "xcodebuild -list",
      "xcodebuild -workspace",
    ])
  })

  it("leaves build folders, pods and Xcode's per-user state out of the key", async () => {
    await files(dir, { "Hello/App.swift": "@main" })

    const first = await sourceHash(dir, "r", XCODE_OUTPUTS)

    await files(dir, {
      "build/out.o": "1",
      "Pods/x.h": "1",
      "Hello.xcodeproj/xcuserdata/me.xcuserdatad/x.plist": "1",
    })
    expect(await sourceHash(dir, "r", XCODE_OUTPUTS)).toBe(first)

    await files(dir, { "Hello/App.swift": "@main struct A {}" })
    expect(await sourceHash(dir, "r", XCODE_OUTPUTS)).not.toBe(first)
  })

  it("is what buildIos picks for a folder with an Xcode project", async () => {
    await files(dir, { "Hello.xcodeproj/project.pbxproj": "" })

    const fake = fakeExec(() => {
      throw new Error("no Xcode here")
    })

    await expect(buildIos({ project: dir, exec: fake.exec, env: {} })).rejects.toThrow(
      "no Xcode here",
    )
    expect(steps(fake.calls)).toEqual(["xcodebuild -list"])
  })
})

/** An SDK folder with two build-tools versions, and the environment naming it. */
async function sdk(): Promise<NodeJS.ProcessEnv> {
  await files(dir, {
    "sdk/build-tools/9.0.0/aapt2": "",
    "sdk/build-tools/36.1.0/aapt2": "",
    "sdk/build-tools/notes/aapt2": "",
  })

  return { ANDROID_HOME: join(dir, "sdk"), JAVA_HOME: join(dir, "jdk") }
}

describe("the native Android build", () => {
  it("runs Gradle with no daemon left behind, and hands it danwo's network config", async () => {
    const args = gradleArgs("release", "/b/danwo-network.gradle")

    expect(args).toEqual([
      "assembleRelease",
      "--console=plain",
      "--no-daemon",
      "-Pkotlin.compiler.execution.strategy=in-process",
      "--init-script",
      "/b/danwo-network.gradle",
    ])
    expect(gradleArgs("freeDebug", "/s")[0]).toBe("assembleFreeDebug")

    const script = networkInitScript("/b/net")

    expect(script).toContain('plugins.withId("com.android.application")')
    expect(script).toContain('addStaticSourceDirectory("/b/net/res")')
    expect(script).toContain('addStaticManifestFile("/b/net/AndroidManifest.xml")')
    expect(NETWORK_MANIFEST).toContain('tools:replace="android:networkSecurityConfig"')
  })

  it("signs an unsigned release APK with the debug key, reads its package, then reuses it", async () => {
    const env = await sdk()
    const project = join(dir, "app")

    await files(project, { "settings.gradle.kts": "", gradlew: "", "app/src/Main.kt": "" })

    const fake = fakeExec(async ({ command, args }) => {
      if (command === "./gradlew")
        await files(project, {
          "app/build/outputs/apk/release/app-release-unsigned.apk": "unsigned",
          "app/build/outputs/apk/debug/app-debug.apk": "an older debug build",
        })
      if (command.endsWith("apksigner")) await writeFile(args.at(-2) ?? "", "signed")

      return command.endsWith("aapt2") ? "dev.danwo.hello\n" : ""
    })
    const built = await buildGradle({ project, env, exec: fake.exec })

    expect(built).toMatchObject({ cached: false, package: "dev.danwo.hello" })
    expect(await readFile(built.apk, "utf8")).toBe("signed")

    const ran = fake.calls.map((call) => call.command.split(/[\\/]/).at(-1))

    expect(ran.filter((tool) => tool !== "keytool")).toEqual(["gradlew", "apksigner", "aapt2"])
    expect(fake.calls[0]?.cwd).toBe(project)
    /* The newest build-tools version, by number, not by name. */
    expect(fake.calls.at(-1)?.command).toBe(join(dir, "sdk", "build-tools", "36.1.0", "aapt2"))

    const script = fake.calls[0]?.args.at(-1) ?? ""

    expect(await readFile(script, "utf8")).toContain("addStaticManifestFile")
    expect(
      await readFile(
        join(dirname(script), "res", "xml", "danwo_network_security_config.xml"),
        "utf8",
      ),
    ).toContain('<certificates src="user" />')

    fake.calls.length = 0
    expect(await buildGradle({ project, env, exec: fake.exec })).toMatchObject({
      apk: built.apk,
      cached: true,
    })
    expect(fake.calls.map((call) => call.command.split(/[\\/]/).at(-1))).toEqual(["aapt2"])
  })

  it("copies a signed debug APK as it is, and says so when the variant made none", async () => {
    const env = await sdk()
    const project = join(dir, "app")

    await files(project, { "settings.gradle.kts": "", gradlew: "" })

    const fake = fakeExec(async ({ command }) => {
      if (command === "./gradlew")
        await files(project, { "app/build/outputs/apk/debug/app-debug.apk": "debug" })

      return "dev.danwo.hello"
    })
    const built = await buildAndroid({ project, variant: "debug", env, exec: fake.exec })

    expect(await readFile(built.apk, "utf8")).toBe("debug")
    expect(fake.calls[0]?.args[0]).toBe("assembleDebug")

    await expect(
      buildGradle({ project, variant: "staging", env, exec: fake.exec, force: true }),
    ).rejects.toThrow("no staging APK")
  })
})

describe("Interface Builder's daemons", () => {
  it("finds the ones this build started by the mark in their command line", () => {
    const listing = [
      "  101 /Applications/Xcode.app/Contents/Developer/usr/bin/ibtoold --persona ibtool HOME=/u DANWO_IOS_BUILD=b1",
      "  102 /Applications/Xcode.app/Contents/Developer/usr/bin/ibtoold --sending-client-environment DANWO_IOS_BUILD=b2",
      "  103 /usr/bin/grep DANWO_IOS_BUILD=b1",
      "  104 /Applications/Xcode.app/Contents/Developer/usr/bin/ibtoold --persona ibtool",
    ].join("\n")

    expect(interfaceBuilderDaemons(listing, "b1")).toEqual([101])
    expect(interfaceBuilderDaemons(listing, "b3")).toEqual([])
  })
})

describe("the Flutter build", () => {
  it("builds for the simulator, and only configures Gradle for the APK, with its daemons switched off", async () => {
    expect(FLUTTER_ARGS.ios).toEqual(["build", "ios", "--simulator", "--debug"])
    expect(FLUTTER_ARGS.android).toEqual(["build", "apk", "--release", "--config-only"])
    expect(flutterAndroidEnv({ GRADLE_OPTS: "-Xmx1g" }).GRADLE_OPTS).toBe(
      "-Xmx1g -Dorg.gradle.daemon=false -Dkotlin.compiler.execution.strategy=in-process",
    )
  })

  it("hands Gradle the JDK in JAVA_HOME", async () => {
    await files(dir, { "jdk/bin/java": "" })

    expect(flutterAndroidEnv({ JAVA_HOME: join(dir, "jdk") }).JAVA_HOME).toBe(join(dir, "jdk"))
  })

  it("assembles the APK with the project's own wrapper and danwo's network config", async () => {
    await files(dir, { "pubspec.yaml": "name: app", "sdk/build-tools/35.0.0/aapt2": "" })

    const fake = fakeExec(async ({ command }) => {
      if (command === "./gradlew")
        await files(dir, { "build/app/outputs/flutter-apk/app-release.apk": "apk" })

      return "dev.danwo.flutter"
    })

    await buildFlutterAndroid({
      project: dir,
      exec: fake.exec,
      env: { ANDROID_HOME: join(dir, "sdk") },
    })

    const gradle = fake.calls.find((call) => call.command === "./gradlew")
    const script = gradle?.args[gradle.args.indexOf("--init-script") + 1] ?? ""

    expect(gradle?.cwd).toBe(join(dir, "android"))
    expect(gradle?.args.slice(0, 3)).toEqual(["assembleRelease", "--console=plain", "--no-daemon"])
    expect(await readFile(script, "utf8")).toBe(networkInitScript(dirname(script)))
    expect(
      existsSync(join(dirname(script), "res", "xml", "danwo_network_security_config.xml")),
    ).toBe(true)
  })

  it("keeps Flutter's iOS and Android projects in the key, and the generated files out", async () => {
    await files(dir, { "pubspec.yaml": "name: app", "lib/main.dart": "void main() {}" })

    const { FLUTTER_OUTPUTS } = await import("../src/build/flutter.ts")
    const first = await sourceHash(dir, "r", FLUTTER_OUTPUTS)

    await files(dir, {
      "build/app.apk": "1",
      "ios/Flutter/Generated.xcconfig": "1",
      "ios/Flutter/ephemeral/x": "1",
    })
    expect(await sourceHash(dir, "r", FLUTTER_OUTPUTS)).toBe(first)

    await files(dir, { "ios/Runner/Info.plist": "<plist/>" })
    expect(await sourceHash(dir, "r", FLUTTER_OUTPUTS)).not.toBe(first)
  })

  it("copies Runner.app and the release APK out of Flutter's build folder", async () => {
    await files(dir, {
      "pubspec.yaml": "name: app",
      "sdk/build-tools/35.0.0/aapt2": "",
    })

    const fake = fakeExec(async ({ args }) => {
      if (args[1] === "ios")
        await files(dir, { "build/ios/iphonesimulator/Runner.app/Info.plist": "" })
      if (args[0] === "assembleRelease")
        await files(dir, { "build/app/outputs/flutter-apk/app-release.apk": "apk" })

      return "dev.danwo.flutter"
    })
    const ios = await buildFlutterIos({ project: dir, exec: fake.exec, env: {} })
    const android = await buildFlutterAndroid({
      project: dir,
      exec: fake.exec,
      env: { ANDROID_HOME: join(dir, "sdk") },
    })

    expect(ios).toMatchObject({ cached: false, bundleId: "dev.danwo.flutter" })
    expect(android).toMatchObject({ cached: false, package: "dev.danwo.flutter" })
    expect(steps(fake.calls)).toEqual([
      "flutter build",
      "plutil -replace",
      "plutil -extract",
      "flutter build",
      "gradlew assembleRelease",
      "aapt2 dump",
    ])
  })
})
