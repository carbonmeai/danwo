/** Why an agent step found no recording to replay. */
import type { CacheNote } from "../record/steps.ts"
import type { ReplayStore, StepKey } from "../replay/store.ts"
import { NothingRecorded, StaleRecording } from "./errors.ts"

/**
 * No cache (`off`), a recording of the same step under another key (`stale`, with what changed),
 * or none at all (`missed`).
 */
export async function missOf(
  store: ReplayStore | undefined,
  key: StepKey | undefined,
): Promise<CacheNote> {
  if (store === undefined || key === undefined || !store.reads) return { mode: "off" }

  const changed = await store.stale(key)

  return changed === undefined ? { mode: "missed" } : { mode: "stale", changed }
}

/** A recording that stopped matching, as its replay said why. */
export interface Mismatch {
  readonly reason: string
  /** Every action ran, but the step did not have its recorded effect. */
  readonly effect?: boolean
}

/** The note of a step whose recording stopped matching: the model took it over, and why. */
export function handedOff(mismatch: Mismatch, redact: (text: string) => string): CacheNote {
  return {
    mode: "handed-off",
    reason: redact(mismatch.reason),
    ...(mismatch.effect === true && { because: "effect" }),
  }
}

/** What a strict replay's diverged step keeps of the hand-off it would have been. */
export function divergedNote(miss: CacheNote): Omit<CacheNote, "mode"> {
  return {
    ...(miss.because !== undefined && { because: miss.because }),
    ...(miss.reason !== undefined && { reason: miss.reason }),
  }
}

/** The error a strict replay fails a step with when it has nothing to replay. */
export function missError(index: number, instruction: string, miss: CacheNote): Error {
  return miss.mode === "stale"
    ? new StaleRecording(index, instruction, miss.changed ?? [])
    : new NothingRecorded(index, instruction)
}
