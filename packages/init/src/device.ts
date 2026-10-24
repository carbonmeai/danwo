/**
 * Whether this machine can run Android tests, in the words init shows: what to fix, and the
 * first AVD danwo could boot. The check is `@danwo/mobile`'s, which init adds to a mobile project:
 * before that, when init runs from a danwo without it, the check waits for `danwo device doctor`.
 */
import { loadOptional, PackageMissingError } from "@danwo/runner/runner"

/** One line of the device doctor's report. */
interface DoctorCheck {
  readonly name: string
  readonly status: "ok" | "warn" | "fail"
  readonly detail: string
}

export interface DeviceCheck {
  /** Each failed or doubtful check, as `name: what to do`. */
  readonly problems: readonly string[]
  /** An AVD that passed, by name. */
  readonly avd: string | undefined
  /** Why the machine was not checked: `@danwo/mobile`, which checks it, is not installed yet. */
  readonly skipped?: string
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

/** What init says when it cannot check the machine before `@danwo/mobile` is installed. */
export const SKIPPED_CHECK: DeviceCheck = {
  problems: [],
  avd: undefined,
  skipped:
    "npx @danwo/cli device doctor checks this machine for Android tests once @danwo/mobile is installed",
}

/** Runs the device doctor (`danwo device doctor`) on this machine, when `@danwo/mobile` is here. */
export async function checkDevice(): Promise<DeviceCheck> {
  try {
    const { deviceDoctor } = await loadOptional(
      "@danwo/mobile",
      "danwo init's device check",
      () => import("@danwo/mobile"),
    )

    return deviceCheckOf(await deviceDoctor(undefined, { platform: "android" }))
  } catch (error) {
    if (error instanceof PackageMissingError) return SKIPPED_CHECK
    throw error
  }
}
