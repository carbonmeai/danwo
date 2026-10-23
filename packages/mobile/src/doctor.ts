/**
 * `danwo device doctor`: what a machine needs to run danwo tests on an Android emulator or an iOS
 * Simulator, checked without changing anything. An SDK can look installed when its system images
 * are only stubs, so images are checked for their files, not just their folders.
 */
import { existsSync } from "node:fs"
import { readdir, readFile } from "node:fs/promises"
import { homedir, platform } from "node:os"
import { join } from "node:path"

import { Adb, type Exec, execProgram } from "./adb.ts"
import { runningSerials } from "./android/emulator.ts"
import { iosDoctor } from "./ios/doctor.ts"
import { androidSdkRoot, androidTools, javaHome } from "./toolchain.ts"

/** One finding. */
export interface DoctorCheck {
  /** The platform the check is for. */
  readonly platform?: "android" | "ios"
  readonly name: string
  readonly status: "ok" | "warn" | "fail"
  readonly detail: string
}

/** A system image folder with the files an emulator boots from. */
function bootable(dir: string): boolean {
  return ["system.img", "vendor.img", "ramdisk.img"].every((file) => existsSync(join(dir, file)))
}

/** Every `system-images/<api>/<tag>/<abi>` folder in the SDK. */
async function systemImages(sdk: string): Promise<string[]> {
  const root = join(sdk, "system-images")
  const found: string[] = []

  if (!existsSync(root)) return found

  for (const api of await readdir(root)) {
    for (const tag of await readdir(join(root, api)).catch(() => [])) {
      for (const abi of await readdir(join(root, api, tag)).catch(() => [])) {
        found.push(join("system-images", api, tag, abi))
      }
    }
  }

  return found
}

function imageChecks(sdk: string, images: readonly string[]): DoctorCheck[] {
  const usable = images.filter((image) => bootable(join(sdk, image)))
  const rootable = usable.filter((image) => /[\\/](google_apis|default)[\\/]/.test(image))
  const stubs = images.filter((image) => !usable.includes(image))

  return [
    {
      name: "system images",
      status: rootable.length > 0 ? "ok" : "fail",
      detail:
        rootable.length > 0
          ? `rootable: ${rootable.join(", ")}`
          : "no rootable image (install a Google APIs image, not Google Play, in Android Studio's SDK Manager)",
    },
    ...(stubs.length > 0
      ? [
          {
            name: "incomplete images",
            status: "warn" as const,
            detail: `${stubs.join(", ")} lack system.img/vendor.img/ramdisk.img; reinstall them`,
          },
        ]
      : []),
  ]
}

/** The AVDs and the image each one boots, with whether it can be rooted. */
async function avdChecks(sdk: string): Promise<DoctorCheck[]> {
  const dir = join(homedir(), ".android", "avd")
  const configs = existsSync(dir)
    ? (await readdir(dir)).filter((name) => name.endsWith(".avd"))
    : []

  if (configs.length === 0) {
    return [{ name: "AVDs", status: "fail", detail: "no AVD: create one on a Google APIs image" }]
  }

  return Promise.all(
    configs.map(async (avd): Promise<DoctorCheck> => {
      const config = await readFile(join(dir, avd, "config.ini"), "utf8").catch(() => "")
      /* Windows writes the folder with backslashes, and a trailing one. */
      const image =
        /image\.sysdir\.1\s*=\s*(.+)/
          .exec(config)?.[1]
          ?.trim()
          .replace(/[\\/]$/, "") ?? ""
      const name = avd.replace(/\.avd$/, "")
      const playStore = /PlayStore\.enabled\s*=\s*true/.test(config) || image.includes("playstore")

      if (!bootable(join(sdk, image)))
        return {
          name: `AVD ${name}`,
          status: "warn",
          detail: `its image ${image} is missing or incomplete`,
        }
      if (playStore)
        return {
          name: `AVD ${name}`,
          status: "warn",
          detail: "a Google Play image cannot be rooted; danwo cannot install its CA",
        }

      return { name: `AVD ${name}`, status: "ok", detail: image }
    }),
  )
}

/** Running emulators whose proxy setting points at a port nothing forwards: their network is dead. */
async function staleProxies(sdk: string, exec: Exec): Promise<DoctorCheck[]> {
  const adbPath = join(sdk, "platform-tools", "adb")
  const serials = await runningSerials(adbPath, exec).catch((): string[] => [])

  return Promise.all(
    serials.map(async (serial): Promise<DoctorCheck> => {
      const adb = new Adb(adbPath, serial, exec)
      const proxy = await adb.shell("settings get global http_proxy").catch(() => "")
      const reverse = await adb.run(["reverse", "--list"]).catch(() => "")
      const set = proxy !== "" && proxy !== "null" && proxy !== ":0"

      if (set && reverse.trim() === "") {
        return {
          name: `emulator ${serial}`,
          status: "warn",
          detail: `http_proxy is ${proxy} with nothing forwarded: run \`adb -s ${serial} shell settings put global http_proxy :0\``,
        }
      }

      return {
        name: `emulator ${serial}`,
        status: "ok",
        detail: set ? `bound (${proxy})` : "running",
      }
    }),
  )
}

/** Options of `deviceDoctor`. */
export interface DoctorOptions {
  /** Check one platform only; both by default (iOS only on a Mac). */
  readonly platform?: "android" | "ios"
}

/** Every check, in the order to fix them: Android's, then iOS's. */
export async function deviceDoctor(
  exec: Exec = execProgram,
  options: DoctorOptions = {},
): Promise<DoctorCheck[]> {
  const android = options.platform === "ios" ? [] : (await androidDoctor(exec)).map(on("android"))
  const mac = platform() === "darwin"
  const ios =
    options.platform === "android" || (options.platform === undefined && !mac)
      ? []
      : mac
        ? (await iosDoctor(exec)).map(on("ios"))
        : [
            {
              platform: "ios" as const,
              name: "Xcode",
              status: "fail" as const,
              detail: "the iOS Simulator runs only on a Mac: run the iOS tests on one",
            },
          ]

  return [...android, ...ios]
}

/**
 * Flutter, for a project with a `pubspec.yaml`: `danwo build-android` and `danwo build-ios` run
 * the `flutter` on PATH, so it must be there.
 */
export async function flutterDoctor(exec: Exec = execProgram): Promise<DoctorCheck[]> {
  try {
    const said = await exec("flutter", ["--version"], { timeoutMs: 120_000 })
    const first = said.trim().split("\n")[0] ?? ""
    const version = first.split("•")[0]?.trim() ?? ""

    return [{ name: "Flutter", status: "ok", detail: version === "" ? "flutter" : version }]
  } catch {
    return [
      {
        name: "Flutter",
        status: "fail",
        detail:
          "not found: install Flutter (https://docs.flutter.dev/get-started/install) and put its bin folder on PATH",
      },
    ]
  }
}

/** Tags a check with its platform. */
function on(name: "android" | "ios") {
  return (check: DoctorCheck): DoctorCheck => ({ platform: name, ...check })
}

/** Android's checks. */
async function androidDoctor(exec: Exec): Promise<DoctorCheck[]> {
  const sdk = androidSdkRoot()

  if (sdk === undefined) {
    return [
      {
        name: "Android SDK",
        status: "fail",
        detail: "not found: set ANDROID_HOME or install Android Studio",
      },
    ]
  }

  const java = javaHome()
  /* The SDK's own paths, `adb.exe` and `emulator.exe` on Windows. */
  const { adb, emulator } = androidTools({ ANDROID_HOME: sdk })
  const tools = Object.entries({ adb, emulator }).map(([name, path]): DoctorCheck => ({
    name,
    status: existsSync(path) ? "ok" : "fail",
    detail: existsSync(path) ? path : `missing: install it in Android Studio's SDK Manager`,
  }))

  return [
    { name: "Android SDK", status: "ok", detail: sdk },
    ...tools,
    ...imageChecks(sdk, await systemImages(sdk)),
    ...(await avdChecks(sdk)),
    {
      name: "JDK",
      status: java === undefined ? "warn" : "ok",
      detail:
        java ??
        "not found: only needed to build apps (`danwo build-android`); Android Studio's works",
    },
    ...(await staleProxies(sdk, exec)),
  ]
}
