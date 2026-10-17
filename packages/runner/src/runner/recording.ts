/**
 * A run's flight recording as a whole: where its records go, and the report written over them when
 * the run ends. Each worker writes the records of its own attempts and trials.
 */
import { relative } from "node:path"

import type { LoadedConfig } from "./config.ts"
import { newRunDir, type RecordMode, type RecordSettings } from "./record.ts"
import { finishRun } from "./report.ts"

/** The run's recording settings: the option, else the config, else `on-failure`; none when off. */
export function openRecording(
  loaded: LoadedConfig,
  mode: RecordMode | undefined,
): RecordSettings | undefined {
  const chosen = mode ?? loaded.config.record ?? "on-failure"

  return chosen === "off" ? undefined : { runDir: newRunDir(loaded.root), mode: chosen }
}

/** Writes the run's report over whatever records were kept, and says where it is. */
export async function closeRecording(
  recording: RecordSettings | undefined,
  cwd: string,
  write: (line: string) => void,
): Promise<void> {
  const report = recording && (await finishRun(recording.runDir))

  if (report !== undefined) write(`report: ${relative(cwd, report)}`)
}
