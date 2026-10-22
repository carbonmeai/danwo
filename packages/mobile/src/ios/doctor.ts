/**
 * What a Mac needs to run danwo tests on an iOS Simulator: Xcode itself (not only its command-line
 * tools, which have no Simulator), simctl, an iOS runtime, and CocoaPods for building Expo apps.
 * Checked without changing anything.
 */
import type { Exec } from "../adb.ts"
import type { DoctorCheck } from "../doctor.ts"
import { Simctl } from "./simctl.ts"
import { DEFAULT_SIMULATOR_NAME, pickDeviceType, pickRuntime } from "./simulator.ts"

/** The output of a tool, or undefined when it fails. */
async function said(
  exec: Exec,
  file: string,
  args: readonly string[],
): Promise<string | undefined> {
  try {
    return (await exec(file, args)).trim()
  } catch {
    return undefined
  }
}

/** Xcode's developer folder and version. */
async function xcodeChecks(exec: Exec): Promise<DoctorCheck[]> {
  const developer = await said(exec, "xcode-select", ["-p"])

  if (developer === undefined)
    return [
      { name: "Xcode", status: "fail", detail: "not found: install Xcode from the App Store" },
    ]

  if (!developer.includes(".app/")) {
    return [
      {
        name: "Xcode",
        status: "fail",
        detail: `${developer} is the command-line tools only, which have no Simulator: install Xcode and run \`sudo xcode-select -s /Applications/Xcode.app\``,
      },
    ]
  }

  const version = await said(exec, "xcodebuild", ["-version"])

  return [
    {
      name: "Xcode",
      status: version === undefined ? "fail" : "ok",
      detail:
        version === undefined
          ? `${developer}: xcodebuild does not run (accept the licence: \`sudo xcodebuild -license\`)`
          : `${version.split("\n").join(", ")} (${developer})`,
    },
  ]
}

/** The iOS runtimes, the simulator danwo would create, and danwo's simulators. */
async function simulatorChecks(simctl: Simctl): Promise<DoctorCheck[]> {
  try {
    const runtimes = (await simctl.runtimes()).filter((runtime) => runtime.name.startsWith("iOS"))

    if (runtimes.length === 0) {
      return [
        {
          name: "iOS runtimes",
          status: "fail",
          detail: "none installed: add one in Xcode (Settings → Components)",
        },
      ]
    }

    const newest = pickRuntime(runtimes, undefined)
    const type = pickDeviceType(newest, undefined)
    const own = (await simctl.devices()).filter((device) =>
      device.name.startsWith(DEFAULT_SIMULATOR_NAME),
    )

    return [
      { name: "simctl", status: "ok", detail: "xcrun simctl" },
      { name: "iOS runtimes", status: "ok", detail: runtimes.map((each) => each.name).join(", ") },
      {
        name: "simulators",
        status: "ok",
        detail:
          own.length === 0
            ? `danwo creates "${DEFAULT_SIMULATOR_NAME}" (${type.name}, ${newest.name}) on first use`
            : own.map((device) => `${device.name} (${device.state})`).join(", "),
      },
    ]
  } catch (error) {
    return [
      {
        name: "simctl",
        status: "fail",
        detail: `xcrun simctl does not run: ${error instanceof Error ? error.message : String(error)}`,
      },
    ]
  }
}

/** Every iOS check, in the order to fix them. */
export async function iosDoctor(exec: Exec): Promise<DoctorCheck[]> {
  const xcode = await xcodeChecks(exec)

  if (xcode.some((check) => check.status === "fail")) return xcode

  const pods = await said(exec, "pod", ["--version"])

  return [
    ...xcode,
    ...(await simulatorChecks(new Simctl(exec))),
    {
      name: "CocoaPods",
      status: pods === undefined ? "warn" : "ok",
      detail: pods ?? "not found: only needed to build Expo apps (`danwo build-ios`)",
    },
  ]
}
