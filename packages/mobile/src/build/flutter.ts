/**
 * The danwo build of a Flutter app: `flutter build ios --simulator` for the iOS Simulator (Flutter
 * builds simulators in debug mode only), and for Android the release APK (signed with the debug
 * key, as Flutter's template does) with danwo's network config added through the same Gradle init
 * script a native build gets. Each is kept by a hash of the app's sources, where `ios/` and
 * `android/` are sources, not outputs.
 */
import { copyFile, cp, rm } from "node:fs/promises"
import { join } from "node:path"

import { androidSdkRoot, javaHome } from "../toolchain.ts"
import { buildTools, gradleArgs, packageOf, writeNetworkConfig } from "./gradle.ts"
import { type AndroidBuild, type BuildExec, buildSlot, type IosBuild, sourceHash } from "./slot.ts"
import { openTransportSecurity, simulatorSlot } from "./xcode.ts"

/** Changes whenever the build steps change, so builds made by older steps are not reused. */
const RECIPE = "danwo-flutter-2"

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

/**
 * `flutter build`'s arguments for each platform. On Android, Flutter only writes the Gradle
 * project's configuration (`local.properties`, the wrapper); the project's own wrapper then builds
 * the APK, so danwo's init script joins the build.
 */
export const FLUTTER_ARGS = {
  ios: ["build", "ios", "--simulator", "--debug"],
  android: ["build", "apk", "--release", "--config-only"],
} as const

/**
 * The environment the Android build runs in: a JDK for Gradle (`JAVA_HOME`, else Android Studio's
 * own), and Gradle's and the Kotlin compiler's daemons switched off through the properties Gradle
 * reads from `GRADLE_OPTS`, so nothing outlives the build.
 */
export function flutterAndroidEnv(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const off = "-Dorg.gradle.daemon=false -Dkotlin.compiler.execution.strategy=in-process"
  const java = javaHome(base)

  return {
    ...base,
    ...(java !== undefined && { JAVA_HOME: java }),
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
  await slot.step(
    "./gradlew",
    gradleArgs("release", await writeNetworkConfig(slot)),
    join(project, "android"),
  )
  await copyFile(join(project, "build", "app", "outputs", "flutter-apk", "app-release.apk"), apk)

  return done(false)
}
