/**
 * `danwo build-ios`: the danwo build of an Expo app for the iOS Simulator, a Release `.app` with its
 * JavaScript bundled (no Metro at test time). Runs `expo prebuild` (which installs the CocoaPods),
 * applies the danwo network config, then `xcodebuild` for the simulator with no code signing. A
 * build is kept by a hash of the app's sources, so an unchanged app is not built again.
 */
import { cp, readdir, rm } from "node:fs/promises"
import { join } from "node:path"

import { buildSlot, sourceHash } from "./build.ts"
import { applyIosNetworkConfig } from "./ios-network.ts"

/** Options of `buildIos`. */
export interface BuildIosOptions {
  /** The Expo project's folder (where its package.json and app config are). */
  readonly project: string
  /** Build again even when a build of the same sources is kept. */
  readonly force?: boolean
  /** Each line the tools print; the build is quiet otherwise (the full log is kept on disk). */
  readonly onLine?: (line: string) => void
}

/** What `buildIos` produced. */
export interface IosBuild {
  /** The simulator app (`.app` folder), kept under the project's `.danwo/builds/`. */
  readonly app: string
  /** True when an earlier build of the same sources was reused. */
  readonly cached: boolean
  readonly durationMs: number
  /** The build's full log. */
  readonly log: string
}

/** Changes whenever the build steps change, so builds made by older steps are not reused. */
const RECIPE = "danwo-ios-2"

/** The environment Expo, CocoaPods and Xcode run in, with the danwo build switched on. */
function buildEnv(): NodeJS.ProcessEnv {
  if (process.platform !== "darwin") throw new Error("iOS builds need a Mac with Xcode")

  return {
    ...process.env,
    DANWO: "1",
    CI: "1",
    EXPO_NO_TELEMETRY: "1",
    /* CocoaPods refuses to run in a non-UTF-8 locale. */
    LANG: process.env.LANG ?? "en_US.UTF-8",
  }
}

/** The Xcode workspace `expo prebuild` wrote, by name: `DanwoShop` for `DanwoShop.xcworkspace`. */
export async function workspaceName(iosDir: string): Promise<string> {
  const workspace = (await readdir(iosDir)).find((entry) => entry.endsWith(".xcworkspace"))

  if (workspace === undefined) throw new Error(`no Xcode workspace in ${iosDir}`)

  return workspace.slice(0, -".xcworkspace".length)
}

/** The `xcodebuild` arguments for a Release simulator build of `scheme`, for this Mac's CPU only. */
export function xcodebuildArgs(scheme: string, derivedData: string, arch: string): string[] {
  return [
    "-workspace",
    `${scheme}.xcworkspace`,
    "-scheme",
    scheme,
    "-configuration",
    "Release",
    "-sdk",
    "iphonesimulator",
    "-destination",
    "generic/platform=iOS Simulator",
    "-derivedDataPath",
    derivedData,
    `ARCHS=${arch === "x64" ? "x86_64" : "arm64"}`,
    "CODE_SIGNING_ALLOWED=NO",
    "COMPILER_INDEX_STORE_ENABLE=NO",
  ]
}

/** Builds the danwo simulator app of the Expo app in `options.project`, or returns the kept one. */
export async function buildIos(options: BuildIosOptions): Promise<IosBuild> {
  const started = Date.now()
  const { project } = options
  const slot = await buildSlot({
    ...options,
    file: `${await sourceHash(project, RECIPE)}.app`,
    logName: "build-ios.log",
    env: buildEnv,
  })
  const { path: app, log, step } = slot

  if (slot.reuse) return { app, cached: true, durationMs: Date.now() - started, log }

  const iosDir = join(project, "ios")
  const derivedData = join(iosDir, "build", "danwo")

  await slot.install()
  await step("npx", ["expo", "prebuild", "--platform", "ios"])

  const scheme = await workspaceName(iosDir)

  await applyIosNetworkConfig(join(iosDir, scheme, "Info.plist"))
  await step("xcodebuild", xcodebuildArgs(scheme, derivedData, process.arch), iosDir)
  await rm(app, { recursive: true, force: true })
  await cp(
    join(derivedData, "Build", "Products", "Release-iphonesimulator", `${scheme}.app`),
    app,
    {
      recursive: true,
      verbatimSymlinks: true,
    },
  )

  return { app, cached: false, durationMs: Date.now() - started, log }
}
