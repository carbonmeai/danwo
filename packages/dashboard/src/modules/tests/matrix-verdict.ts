/** What the fault matrix made of a test, from its newest matrix run. */
import type { MatrixHistory } from "@danwo/runner/runner"

/** What the latest matrix run of a test made of it. */
export type MatrixVerdict =
  | { readonly kind: "none" }
  | { readonly kind: "clean-failed"; readonly runId: string }
  | {
      readonly kind: "held" | "broke"
      readonly runId: string
      /** Faults it was judged under, and those that broke it, by label. */
      readonly judged: number
      readonly broke: readonly string[]
    }

/** Statuses that mean a fault broke the run. */
export const BROKE = new Set(["failed", "timed-out", "interrupted"])
const JUDGED = new Set(["passed", "failed", "timed-out", "interrupted"])

/** What the newest matrix run of a test (from `runs`, newest first) made of it. */
export function matrixVerdict(runs: readonly MatrixHistory[]): MatrixVerdict {
  const latest = runs[0]

  if (latest === undefined) return { kind: "none" }
  if (latest.clean.status !== "passed") return { kind: "clean-failed", runId: latest.id }

  const judged = latest.trials.filter((trial) => JUDGED.has(trial.status))
  const broke = judged.filter((trial) => BROKE.has(trial.status)).map((trial) => trial.fault ?? "")

  return {
    kind: broke.length > 0 ? "broke" : "held",
    runId: latest.id,
    judged: judged.length,
    broke,
  }
}
