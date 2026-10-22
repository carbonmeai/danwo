/**
 * Whether this machine can run Android tests, in the words init shows: what to fix, and the
 * first AVD danwo could boot.
 */
import type { DoctorCheck } from "@danwo/mobile"

export interface DeviceCheck {
  /** Each failed or doubtful check, as `name: what to do`. */
  readonly problems: readonly string[]
  /** An AVD that passed, by name. */
  readonly avd: string | undefined
}

/** Reads the device doctor's checks. */
export function deviceCheckOf(checks: readonly DoctorCheck[]): DeviceCheck {
  const ready = checks.find((check) => check.status === "ok" && check.name.startsWith("AVD "))

  return {
    problems: checks
      .filter((check) => check.status !== "ok")
      .map((check) => `${check.name}: ${check.detail}`),
    avd: ready?.name.slice("AVD ".length),
  }
}

/** Runs the device doctor (`danwo device doctor`) on this machine. */
export async function checkDevice(): Promise<DeviceCheck> {
  const { deviceDoctor } = await import("@danwo/mobile")

  return deviceCheckOf(await deviceDoctor(undefined, { platform: "android" }))
}
