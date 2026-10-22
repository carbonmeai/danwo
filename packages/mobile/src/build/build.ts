/**
 * `danwo build-android`: the danwo build of an app as an APK, whatever the project holds. A
 * native Gradle project and a Flutter app build with their own tools (`gradle.ts`, `flutter.ts`).
 * An Expo app builds as a release APK with its JavaScript bundled (no Metro at test time): `expo
 * prebuild`, the danwo network config, then Gradle, with Android Studio's JDK when `JAVA_HOME` is
 * unset. A build is kept by a hash of the app's sources, so an unchanged app is not built again.
 */
import { copyFile } from "node:fs/promises"
import { join } from "node:path"

import { androidSdkRoot, javaHome } from "@danwo/device/toolchain"

import { buildFlutterAndroid } from "./flutter.ts"
import { buildGradle } from "./gradle.ts"
import { applyNetworkConfig } from "./network.ts"
import { androidProject } from "./project.ts"
import { type AndroidBuild, type BuildExec, buildSlot, sourceHash } from "./slot.ts"

/** Options of `buildAndroid`. */
export interface BuildAndroidOptions {
  /** The project's folder: an Expo app, a Gradle project (with `gradlew`) or a Flutter app. */
  readonly project: string
  /** A Gradle project's variant to assemble; default `release`. Not used for Expo or Flutter. */
  readonly variant?: string
  /** Build again even when a build of the same sources is kept. */
  readonly force?: boolean
  /** Each line the tools print; the build is quiet otherwise (the full log is kept on disk). */
  readonly onLine?: (line: string) => void
  /** Runs the tools; tests pass a fake. */
  readonly exec?: BuildExec
  /** The tools' environment, in place of the one found from this machine; tests pass one. */
  readonly env?: NodeJS.ProcessEnv
}

/** The environment Gradle and Expo run in: the SDK, a JDK, and the danwo build switched on. */
function buildEnv(): NodeJS.ProcessEnv {
  const sdk = androidSdkRoot()
  const java = javaHome()

  if (sdk === undefined) throw new Error("no Android SDK found: set ANDROID_HOME")

  if (java === undefined) {
    throw new Error(
      "no JDK found: set JAVA_HOME, or install Android Studio (its bundled JDK works)",
    )
  }

  return {
    ...process.env,
    ANDROID_HOME: sdk,
    JAVA_HOME: java,
    DANWO: "1",
    CI: "1",
    EXPO_NO_TELEMETRY: "1",
  }
}

/**
 * Gradle's arguments for the release build. Gradle and the Kotlin compiler would each leave a
 * daemon running after the build; both run inside the build's own process instead, so nothing
 * outlives it.
 */
export const GRADLE_ARGS: readonly string[] = [
  "assembleRelease",
  "--console=plain",
  "--no-daemon",
  "-Pkotlin.compiler.execution.strategy=in-process",
]

/** Builds the danwo APK of the Expo app in `options.project`, or returns the kept one. */
async function buildExpoAndroid(options: BuildAndroidOptions): Promise<AndroidBuild> {
  const started = Date.now()
  const { project } = options
  const slot = await buildSlot({
    ...options,
    file: `${await sourceHash(project)}.apk`,
    logName: "build.log",
    env: () => options.env ?? buildEnv(),
  })
  const { path: apk, log, step } = slot

  if (slot.reuse) return { apk, cached: true, durationMs: Date.now() - started, log }

  await slot.install()
  await step("npx", ["expo", "prebuild", "--platform", "android", "--no-install"])
  await applyNetworkConfig(join(project, "android"))
  await step("./gradlew", GRADLE_ARGS, join(project, "android"))
  await copyFile(
    join(project, "android", "app", "build", "outputs", "apk", "release", "app-release.apk"),
    apk,
  )

  return { apk, cached: false, durationMs: Date.now() - started, log }
}

/**
 * Builds the danwo APK of the app in `options.project`, or returns the kept one: a Flutter app
 * (`pubspec.yaml`), a Gradle project (`settings.gradle(.kts)` and `gradlew`), else an Expo app.
 */
export function buildAndroid(options: BuildAndroidOptions): Promise<AndroidBuild> {
  const project = androidProject(options.project)

  if (project.kind === "flutter") return buildFlutterAndroid(options)
  if (project.kind === "gradle") return buildGradle(options)

  return buildExpoAndroid(options)
}
