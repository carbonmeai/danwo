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

/** The error a strict replay fails a step with when it has nothing to replay. */
export function missError(index: number, instruction: string, miss: CacheNote): Error {
  return miss.mode === "stale"
    ? new StaleRecording(index, instruction, miss.changed ?? [])
    : new NothingRecorded(index, instruction)
}
