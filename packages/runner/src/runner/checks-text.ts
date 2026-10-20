/**
 * The checks of a record as one line each, for the failure page and the offline report: the wait
 * for background work with what it waited for, and each value check with ✓ or ✗ and its values.
 */
import type { StepRecord } from "../record/index.ts"

/** Whether a step ran after the body: the wait for background work, or the invariant's checks. */
export function afterBody(step: Pick<StepRecord, "phase">): boolean {
  return step.phase === "settle" || step.phase === "checks"
}

/** What a check got, and what it wanted when it failed. */
function sides(step: StepRecord): string {
  const { actual, expected } = step.check ?? {}

  if (actual === undefined) return ""
  if (step.status === "passed" || expected === undefined) return ` — got ${actual}`

  return ` — expected ${expected}, got ${actual}`
}

/** One check, or the settle wait, as a line of text. */
export function checkLine(step: StepRecord): string {
  const mark = step.status === "passed" ? "✓" : "✗"

  if (step.kind !== "settle") return `${mark} ${step.label}${sides(step)}`

  const waited = step.waitedOn?.length ? step.waitedOn.join("; ") : "nothing was running"

  return `${mark} waited ${(step.durationMs / 1000).toFixed(1)} s for background work: ${waited}`
}
