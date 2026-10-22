/**
 * The danwo build of a Flutter app: `flutter build ios --simulator` for the iOS Simulator (Flutter
 * builds simulators in debug mode only) and `flutter build apk` for Android (release, signed with
 * the debug key as Flutter's template does). Each is kept by a hash of the app's sources, where
 * `ios/` and `android/` are sources, not outputs.
 */
import { copyFile, cp, rm } from "node:fs/promises"
import { join } from "node:path"

import { androidSdkRoot } from "@danwo/device/toolchain"

import { buildTools, packageOf } from "./gradle.ts"
import { type AndroidBuild, type BuildExec, buildSlot, type IosBuild, sourceHash } from "./slot.ts"
import { openTransportSecurity, simulatorSlot } from "./xcode.ts"

/** Changes whenever the build steps change, so builds made by older steps are not reused. */
const RECIPE = "danwo-flutter-1"

/**
 * What `flutter build`, `pub get` and CocoaPods write, never part of the key: the build folder,
 * the iOS and Android projects' generated files, and the installed pods.
 */
export const FLUTTER_OUTPUTS: ReadonlySet<string> = new Set([
  "build",
  "Pods",
  "ephemeral",
  "Generated.xcconfig",
  "flutter_export_environment.sh",
  "GeneratedPluginRegistrant.java",
  "GeneratedPluginRegistrant.h",
  "GeneratedPluginRegistrant.m",
  "local.properties",
  "xcuserdata",
])

/** Options of a Flutter build. */
export interface FlutterBuildOptions {
  readonly project: string
  readonly force?: boolean | undefined
  readonly onLine?: ((line: string) => void) | undefined
  readonly exec?: BuildExec | undefined
  /** The tools' environment; this process's by default. */
  readonly env?: NodeJS.ProcessEnv | undefined
}

/** `flutter build`'s arguments for each platform. */
export const FLUTTER_ARGS = {
  ios: ["build", "ios", "--simulator", "--debug"],
  android: ["build", "apk", "--release"],
} as const

/**
 * The environment `flutter build apk` runs in. Flutter runs Gradle with its daemon, which would
 * outlive the build; Gradle's and the Kotlin compiler's daemons are switched off through the
 * properties Gradle reads from `GRADLE_OPTS`, so nothing is left running.
 */
export function flutterAndroidEnv(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const off = "-Dorg.gradle.daemon=false -Dkotlin.compiler.execution.strategy=in-process"

  return {
    ...base,
    CI: "1",
    GRADLE_OPTS: base.GRADLE_OPTS === undefined ? off : `${base.GRADLE_OPTS} ${off}`,
  }
}

/** Builds the Flutter app in `options.project` for the iOS Simulator, or returns the kept build. */
export async function buildFlutterIos(options: FlutterBuildOptions): Promise<IosBuild> {
  const started = Date.now()
  const { project } = options
  const { slot, done } = await simulatorSlot(
    options,
    await sourceHash(project, `${RECIPE}:ios`, FLUTTER_OUTPUTS),
    started,
  )
  const app = slot.path

  if (slot.reuse) return done(true)

  await slot.step("flutter", FLUTTER_ARGS.ios)
  await rm(app, { recursive: true, force: true })
  await cp(join(project, "build", "ios", "iphonesimulator", "Runner.app"), app, {
    recursive: true,
    verbatimSymlinks: true,
  })
  await openTransportSecurity(slot, app)

  return done(false)
}

/** Builds the Flutter app in `options.project` as an APK, or returns the kept build. */
export async function buildFlutterAndroid(options: FlutterBuildOptions): Promise<AndroidBuild> {
  const started = Date.now()
  const { project } = options
  const env = () => options.env ?? flutterAndroidEnv()
  const slot = await buildSlot({
    project,
    force: options.force,
    onLine: options.onLine,
    exec: options.exec,
    file: `${await sourceHash(project, `${RECIPE}:android`, FLUTTER_OUTPUTS)}.apk`,
    logName: "build-android.log",
    env,
  })
  const { path: apk, log } = slot

  const done = async (cached: boolean): Promise<AndroidBuild> => {
    const sdk = env().ANDROID_HOME ?? androidSdkRoot(env())

    return {
      apk,
      ...(sdk !== undefined && { package: await packageOf(slot, apk, await buildTools(sdk)) }),
      cached,
      durationMs: Date.now() - started,
      log,
    }
  }

  if (slot.reuse) return done(true)

  await slot.step("flutter", FLUTTER_ARGS.android)
  await copyFile(join(project, "build", "app", "outputs", "flutter-apk", "app-release.apk"), apk)

  return done(false)
}
