/**
 * Where the Android tools live on this machine: the SDK (adb, the emulator, system images) and a
 * JDK for Gradle. Nothing here installs anything; `device doctor` reports what is missing.
 */
import { existsSync } from "node:fs"
import { homedir, platform } from "node:os"
import { join } from "node:path"

/**
 * The usual SDK folders on `os`, in the order they are tried after `ANDROID_HOME` and
 * `ANDROID_SDK_ROOT`. Android Studio on Windows puts it under `%LOCALAPPDATA%\Android\Sdk`.
 */
export function defaultSdkDirs(
  os: NodeJS.Platform = platform(),
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  const home = homedir()

  if (os === "win32")
    return [join(env.LOCALAPPDATA ?? join(home, "AppData", "Local"), "Android", "Sdk")]

  return os === "darwin"
    ? [join(home, "Library/Android/sdk")]
    : [join(home, "Android/Sdk"), "/opt/android-sdk", "/usr/lib/android-sdk"]
}

/** A program's file name on `os`: Windows gives it `.exe`. */
function program(name: string, os: NodeJS.Platform): string {
  return os === "win32" ? `${name}.exe` : name
}

/** The Android SDK folder, or undefined when none is found. */
export function androidSdkRoot(
  env: NodeJS.ProcessEnv = process.env,
  os: NodeJS.Platform = platform(),
): string | undefined {
  const candidates = [env.ANDROID_HOME, env.ANDROID_SDK_ROOT, ...defaultSdkDirs(os, env)]

  return candidates.find((dir): dir is string => dir !== undefined && dir !== "" && existsSync(dir))
}

/** The SDK's tools by path, so they work without the SDK on PATH. */
export interface AndroidTools {
  readonly sdk: string
  readonly adb: string
  readonly emulator: string
}

/** The SDK's adb and emulator; throws a clear error when the SDK is missing. */
export function androidTools(
  env: NodeJS.ProcessEnv = process.env,
  os: NodeJS.Platform = platform(),
): AndroidTools {
  const sdk = androidSdkRoot(env, os)

  if (sdk === undefined) {
    throw new Error(
      "no Android SDK found: set ANDROID_HOME, or install Android Studio (it puts the SDK in ~/Library/Android/sdk on macOS)",
    )
  }

  return {
    sdk,
    adb: join(sdk, "platform-tools", program("adb", os)),
    emulator: join(sdk, "emulator", program("emulator", os)),
  }
}

/** JDKs that ship with Android Studio, which builds React Native apps without a system Java. */
function bundledJdks(os: NodeJS.Platform, env: NodeJS.ProcessEnv): string[] {
  if (os === "win32")
    return [
      join(env.ProgramFiles ?? String.raw`C:\Program Files`, "Android", "Android Studio", "jbr"),
    ]

  return os === "darwin"
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
export function javaHome(
  env: NodeJS.ProcessEnv = process.env,
  os: NodeJS.Platform = platform(),
): string | undefined {
  const candidates = [env.JAVA_HOME, ...bundledJdks(os, env)]

  return candidates.find(
    (dir): dir is string =>
      dir !== undefined && dir !== "" && existsSync(join(dir, "bin", program("java", os))),
  )
}
