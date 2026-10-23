/**
 * `danwo build-ios`: the danwo build of an app for the iOS Simulator, whatever the project holds. A
 * native Xcode project and a Flutter app build with their own tools (`xcode.ts`, `flutter.ts`). An
 * Expo app builds as a Release `.app` with its JavaScript bundled (no Metro at test time): `expo
 * prebuild` (which installs the CocoaPods), the danwo network config, then `xcodebuild` for the
 * simulator with no code signing. A build is kept by a hash of the app's sources, so an unchanged
 * app is not built again, and a project builds once at a time: the workers of a run share one build.
 */
import { cp, readdir, rm } from "node:fs/promises"
import { join } from "node:path"

import { buildFlutterIos } from "./flutter.ts"
import { applyIosNetworkConfig } from "./ios-network.ts"
import { withBuildLock } from "./lock.ts"
import { iosProject } from "./project.ts"
import { type BuildExec, buildSlot, type IosBuild, sourceHash } from "./slot.ts"
import { buildXcode, iosBuildEnv } from "./xcode.ts"

/** Options of `buildIos`. */
export interface BuildIosOptions {
  /** The project's folder: an Expo app, an Xcode workspace or project, or a Flutter app. */
  readonly project: string
  /** A native project's scheme; found from the project by default. Not used for Expo or Flutter. */
  readonly scheme?: string
  /** A native project's build configuration; default `Release`. */
  readonly configuration?: string
  /** Build again even when a build of the same sources is kept. */
  readonly force?: boolean
  /** Each line the tools print; the build is quiet otherwise (the full log is kept on disk). */
  readonly onLine?: (line: string) => void
  /** Runs the tools; tests pass a fake. */
  readonly exec?: BuildExec
  /** The tools' environment, in place of this machine's; tests pass one. */
  readonly env?: NodeJS.ProcessEnv
}

/** Changes whenever the build steps change, so builds made by older steps are not reused. */
const RECIPE = "danwo-ios-2"

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
async function buildExpoIos(options: BuildIosOptions): Promise<IosBuild> {
  const started = Date.now()
  const { project } = options
  const slot = await buildSlot({
    ...options,
    file: `${await sourceHash(project, RECIPE)}.app`,
    logName: "build-ios.log",
    env: () => ({ ...(options.env ?? iosBuildEnv()), EXPO_NO_TELEMETRY: "1" }),
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

/**
 * Builds the danwo simulator app of the app in `options.project`, or returns the kept one: a
 * Flutter app (`pubspec.yaml`), an Xcode workspace or project, else an Expo app.
 */
export async function buildIos(options: BuildIosOptions): Promise<IosBuild> {
  const project = await iosProject(options.project)

  /* One build of the project at a time: workers that wait reuse the build the first one kept. */
  return withBuildLock(
    join(options.project, ".danwo", "builds", "build-ios.lock"),
    () => {
      if (project.kind === "flutter") return buildFlutterIos(options)
      if (project.kind === "xcode") return buildXcode({ ...options, container: project.container })

      return buildExpoIos(options)
    },
    { onWait: (holder) => options.onLine?.(`waiting for ${holder} to finish building the app`) },
  )
}
