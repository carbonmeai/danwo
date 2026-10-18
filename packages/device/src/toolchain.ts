/**
 * Where the Android tools live on this machine: the SDK (adb, the emulator, system images) and a
 * JDK for Gradle. Nothing here installs anything; `device doctor` reports what is missing.
 */
import { existsSync } from "node:fs"
import { homedir, platform } from "node:os"
import { join } from "node:path"

/** The usual SDK folders, in the order they are tried after `ANDROID_HOME` and `ANDROID_SDK_ROOT`. */
function defaultSdkDirs(): string[] {
  const home = homedir()

  return platform() === "darwin"
    ? [join(home, "Library/Android/sdk")]
    : [join(home, "Android/Sdk"), "/opt/android-sdk", "/usr/lib/android-sdk"]
}

/** The Android SDK folder, or undefined when none is found. */
export function androidSdkRoot(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const candidates = [env.ANDROID_HOME, env.ANDROID_SDK_ROOT, ...defaultSdkDirs()]

  return candidates.find((dir): dir is string => dir !== undefined && dir !== "" && existsSync(dir))
}

/** The SDK's tools by path, so they work without the SDK on PATH. */
export interface AndroidTools {
  readonly sdk: string
  readonly adb: string
  readonly emulator: string
}

/** The SDK's adb and emulator; throws a clear error when the SDK is missing. */
export function androidTools(env: NodeJS.ProcessEnv = process.env): AndroidTools {
  const sdk = androidSdkRoot(env)

  if (sdk === undefined) {
    throw new Error(
      "no Android SDK found: set ANDROID_HOME, or install Android Studio (it puts the SDK in ~/Library/Android/sdk on macOS)",
    )
  }

  return {
    sdk,
    adb: join(sdk, "platform-tools", "adb"),
    emulator: join(sdk, "emulator", "emulator"),
  }
}

/** JDKs that ship with Android Studio, which builds React Native apps without a system Java. */
function bundledJdks(): string[] {
  return platform() === "darwin"
    ? [
        "/Applications/Android Studio.app/Contents/jbr/Contents/Home",
        join(homedir(), "Applications/Android Studio.app/Contents/jbr/Contents/Home"),
      ]
    : [
        join(homedir(), "android-studio/jbr"),
        "/opt/android-studio/jbr",
        "/snap/android-studio/current/jbr",
      ]
}

/** A JDK home for Gradle: `JAVA_HOME` when set, else Android Studio's bundled one. */
export function javaHome(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const candidates = [env.JAVA_HOME, ...bundledJdks()]

  return candidates.find(
    (dir): dir is string => dir !== undefined && dir !== "" && existsSync(join(dir, "bin", "java")),
  )
}
