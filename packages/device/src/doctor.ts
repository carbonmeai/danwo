/**
 * `danwo device doctor`: what a machine needs to run danwo tests on an Android emulator, checked
 * without changing anything. An SDK can look installed when its system images are only stubs, so
 * images are checked for their files, not just their folders.
 */
import { existsSync } from "node:fs"
import { readdir, readFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"

import { Adb, type Exec, execProgram } from "./adb.ts"
import { androidSdkRoot, javaHome } from "./toolchain.ts"

/** One finding. */
export interface DoctorCheck {
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
  const rootable = usable.filter(
    (image) => image.includes("/google_apis/") || image.includes("/default/"),
  )
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
      const image = /image\.sysdir\.1\s*=\s*(.+)/.exec(config)?.[1]?.trim().replace(/\/$/, "") ?? ""
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
  const listing = await exec(adbPath, ["devices"]).catch(() => "")
  const serials = listing
    .split("\n")
    .map((line) => line.trim().split(/\s+/))
    .filter(([serial, state]) => serial?.startsWith("emulator-") === true && state === "device")
    .map(([serial]) => serial ?? "")

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

/** Every check, in the order to fix them. */
export async function deviceDoctor(exec: Exec = execProgram): Promise<DoctorCheck[]> {
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
  const tools = ["platform-tools/adb", "emulator/emulator"].map((tool): DoctorCheck => ({
    name: tool.split("/")[1] ?? tool,
    status: existsSync(join(sdk, tool)) ? "ok" : "fail",
    detail: existsSync(join(sdk, tool))
      ? join(sdk, tool)
      : `missing: install it in Android Studio's SDK Manager`,
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
