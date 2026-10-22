/**
 * The danwo build of a native Android app (Jetpack Compose or Views, no Expo): the project's own
 * Gradle wrapper assembles the variant (`release` by default), with no daemon left behind. An
 * init script adds danwo's network config to the app for this build only, so the APK trusts the
 * user CAs danwo installs and may make plain HTTP calls; the project's files are not touched. An
 * unsigned APK is signed with the debug key so it installs. The APK is kept by a hash of the
 * project's sources.
 */
import { existsSync } from "node:fs"
import { copyFile, mkdir, readdir, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join, sep } from "node:path"

import { androidSdkRoot, javaHome } from "../toolchain.ts"
import { NETWORK_CONFIG_NAME, NETWORK_SECURITY_CONFIG } from "./network.ts"
import { type AndroidBuild, type BuildExec, buildSlot, type BuildSlot, sourceHash } from "./slot.ts"

/** Changes whenever the build steps change, so builds made by older steps are not reused. */
const RECIPE = "danwo-gradle-1"

/**
 * What a Gradle build writes, never part of its key: build folders, native build state, and
 * `local.properties` (this machine's SDK path).
 */
const GRADLE_OUTPUTS: ReadonlySet<string> = new Set(["build", "local.properties", "node_modules"])

/** Options of a native Android build. */
export interface GradleBuildOptions {
  readonly project: string
  /** The variant to assemble: a build type (`release`, `debug`) or a flavor's (`freeRelease`). */
  readonly variant?: string | undefined
  readonly force?: boolean | undefined
  readonly onLine?: ((line: string) => void) | undefined
  readonly exec?: BuildExec | undefined
  /** The tools' environment; found from `ANDROID_HOME` and `JAVA_HOME` by default. */
  readonly env?: NodeJS.ProcessEnv | undefined
}

/**
 * The manifest overlay danwo adds: the app's `networkSecurityConfig` becomes danwo's, replacing
 * one the app sets. Gradle merges it over the app's own manifest.
 */
export const NETWORK_MANIFEST = `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android"
    xmlns:tools="http://schemas.android.com/tools">
  <application
      android:networkSecurityConfig="@xml/${NETWORK_CONFIG_NAME}"
      tools:replace="android:networkSecurityConfig" />
</manifest>
`

/**
 * The init script that hands every app module of the build danwo's network config: the resource
 * folder and the manifest overlay in `dir`, through the Android Gradle plugin's variant API.
 */
export function networkInitScript(dir: string): string {
  /* Forward slashes: Gradle takes them on Windows too, and a backslash would start an escape. */
  const res = JSON.stringify(join(dir, "res").replaceAll("\\", "/"))
  const manifest = JSON.stringify(join(dir, "AndroidManifest.xml").replaceAll("\\", "/"))

  return `// Written by danwo for its own build of this app; the project's files are not changed.
allprojects {
  plugins.withId("com.android.application") {
    androidComponents {
      onVariants(selector().all()) { variant ->
        variant.sources.res.addStaticSourceDirectory(${res})
        variant.sources.manifests.addStaticManifestFile(${manifest})
      }
    }
  }
}
`
}

/** `release` → `assembleRelease`. */
function assembleTask(variant: string): string {
  return `assemble${variant.charAt(0).toUpperCase()}${variant.slice(1)}`
}

/**
 * Gradle's arguments. Gradle and the Kotlin compiler would each leave a daemon running after the
 * build; both run inside the build's own process instead, so nothing outlives it.
 */
export function gradleArgs(variant: string, initScript: string): string[] {
  return [
    assembleTask(variant),
    "--console=plain",
    "--no-daemon",
    "-Pkotlin.compiler.execution.strategy=in-process",
    "--init-script",
    initScript,
  ]
}

/** Every APK under the modules' `build/outputs/apk/`, at most a flavor and a build type deep. */
async function apksIn(project: string): Promise<string[]> {
  const modules = [
    project,
    ...(await readdir(project, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
      .map((entry) => join(project, entry.name)),
  ]
  const found: string[] = []

  const walk = async (dir: string, depth: number): Promise<void> => {
    if (!existsSync(dir)) return

    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)

      if (entry.isDirectory() && depth > 0) await walk(path, depth - 1)
      else if (entry.isFile() && entry.name.endsWith(".apk")) found.push(path)
    }
  }

  for (const module of modules) await walk(join(module, "build", "outputs", "apk"), 2)

  return found.toSorted()
}

/**
 * Whether `apk` is the variant's: its folders under `apk/` spell the variant, as Gradle lays them
 * out (`apk/release/`, or `apk/free/release/` for `freeRelease`).
 */
function ofVariant(apk: string, variant: string): boolean {
  const parts = apk.split(sep)
  const at = parts.lastIndexOf("apk")

  return (
    parts
      .slice(at + 1, -1)
      .join("")
      .toLowerCase() === variant.toLowerCase()
  )
}

/** The APK the build made for `variant`: the app module's only one. */
async function builtApk(project: string, variant: string): Promise<string> {
  const apks = (await apksIn(project)).filter((apk) => ofVariant(apk, variant))

  if (apks.length === 1 && apks[0] !== undefined) return apks[0]

  throw new Error(
    apks.length === 0
      ? `the build wrote no ${variant} APK under ${project}/*/build/outputs/apk/`
      : `the build wrote several ${variant} APKs (${apks.join(", ")}): build one app module at a time`,
  )
}

/** The SDK's newest build-tools folder, where `aapt2` and `apksigner` are. */
export async function buildTools(sdk: string): Promise<string> {
  const dir = join(sdk, "build-tools")
  const versions = existsSync(dir) ? await readdir(dir) : []
  /* A numeric collation orders `36.1.0` after `9.0.0`, part by part. */
  const newest = versions
    .filter((name) => /^\d+(\.\d+)*$/.test(name))
    .toSorted((a, b) => b.localeCompare(a, "en", { numeric: true }))[0]

  if (newest === undefined)
    throw new Error(`no build-tools in ${dir}: install them with the SDK Manager`)

  return join(dir, newest)
}

/** The environment Gradle runs in: the SDK and a JDK. */
function gradleEnv(): NodeJS.ProcessEnv {
  const sdk = androidSdkRoot()
  const java = javaHome()

  if (sdk === undefined) throw new Error("no Android SDK found: set ANDROID_HOME")
  if (java === undefined)
    throw new Error(
      "no JDK found: set JAVA_HOME, or install Android Studio (its bundled JDK works)",
    )

  return { ...process.env, ANDROID_HOME: sdk, JAVA_HOME: java, DANWO: "1", CI: "1" }
}

/** The SDK folder in `env`. */
function sdkOf(env: NodeJS.ProcessEnv): string {
  const sdk = env.ANDROID_HOME ?? androidSdkRoot(env)

  if (sdk === undefined) throw new Error("no Android SDK found: set ANDROID_HOME")

  return sdk
}

/** The package name in an APK's manifest, read with `aapt2`. */
export async function packageOf(
  slot: Pick<BuildSlot, "step">,
  apk: string,
  tools: string,
): Promise<string> {
  return (await slot.step(join(tools, "aapt2"), ["dump", "packagename", apk])).trim()
}

/**
 * Signs `unsigned` into `signed` with the debug key Android Studio and Gradle use, made first
 * when this machine has none, so a release build with no signing config installs.
 */
async function signWithDebugKey(
  slot: Pick<BuildSlot, "step">,
  options: {
    readonly unsigned: string
    readonly signed: string
    readonly tools: string
    readonly java: string
  },
): Promise<void> {
  const keystore = join(homedir(), ".android", "debug.keystore")

  if (!existsSync(keystore)) {
    await mkdir(join(homedir(), ".android"), { recursive: true })
    await slot.step(join(options.java, "bin", "keytool"), [
      "-genkeypair",
      "-keystore",
      keystore,
      "-storepass",
      "android",
      "-alias",
      "androiddebugkey",
      "-keypass",
      "android",
      "-keyalg",
      "RSA",
      "-keysize",
      "2048",
      "-validity",
      "10000",
      "-dname",
      "CN=Android Debug,O=Android,C=US",
    ])
  }

  await slot.step(join(options.tools, "apksigner"), [
    "sign",
    "--ks",
    keystore,
    "--ks-pass",
    "pass:android",
    "--key-pass",
    "pass:android",
    "--ks-key-alias",
    "androiddebugkey",
    "--out",
    options.signed,
    options.unsigned,
  ])
}

/** Writes danwo's network config and the init script that adds it; the script's path. */
export async function writeNetworkConfig(slot: Pick<BuildSlot, "dir">): Promise<string> {
  const dir = join(slot.dir, "android-network")
  const script = join(dir, "danwo-network.gradle")

  await mkdir(join(dir, "res", "xml"), { recursive: true })
  await writeFile(join(dir, "res", "xml", `${NETWORK_CONFIG_NAME}.xml`), NETWORK_SECURITY_CONFIG)
  await writeFile(join(dir, "AndroidManifest.xml"), NETWORK_MANIFEST)
  await writeFile(script, networkInitScript(dir))

  return script
}

/** Builds the native app in `options.project` as an APK, or returns the kept build. */
export async function buildGradle(options: GradleBuildOptions): Promise<AndroidBuild> {
  const started = Date.now()
  const { project } = options
  const variant = options.variant ?? "release"
  const given = options.env
  let env: NodeJS.ProcessEnv | undefined
  const environment = () => (env ??= given ?? gradleEnv())
  const slot = await buildSlot({
    project,
    force: options.force,
    onLine: options.onLine,
    exec: options.exec,
    file: `${await sourceHash(project, `${RECIPE}:${variant}`, GRADLE_OUTPUTS)}.apk`,
    logName: "build-android.log",
    env: environment,
  })
  const { path: apk, log } = slot
  const done = async (cached: boolean): Promise<AndroidBuild> => ({
    apk,
    package: await packageOf(slot, apk, await buildTools(sdkOf(environment()))),
    cached,
    durationMs: Date.now() - started,
    log,
  })

  if (slot.reuse) return done(true)

  const script = await writeNetworkConfig(slot)

  await slot.step("./gradlew", gradleArgs(variant, script))

  const built = await builtApk(project, variant)

  if (built.endsWith("-unsigned.apk")) {
    const java = environment().JAVA_HOME ?? javaHome()

    if (java === undefined) throw new Error("no JDK found to sign the APK with: set JAVA_HOME")

    await signWithDebugKey(slot, {
      unsigned: built,
      signed: apk,
      tools: await buildTools(sdkOf(environment())),
      java,
    })
  } else await copyFile(built, apk)

  return done(false)
}
