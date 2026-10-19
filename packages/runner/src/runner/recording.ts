/**
 * A run's flight recording as a whole: where its records go, and the report written over them when
 * the run ends. Each worker writes the records of its own attempts and trials.
 */
import { relative } from "node:path"

import type { VideoMode } from "../record/video.ts"
import type { LoadedConfig } from "./config.ts"
import { newRunDir, type RecordMode, type RecordSettings } from "./record.ts"
import { finishRun } from "./report.ts"

/**
 * The run's recording settings: the option, else the config, else `always`; none when off.
 * Video follows the same order and defaults to `on`.
 */
export function openRecording(
  loaded: LoadedConfig,
  mode: RecordMode | undefined,
  video?: VideoMode,
): RecordSettings | undefined {
  const chosen = mode ?? loaded.config.record ?? "always"

  return chosen === "off"
    ? undefined
    : {
        runDir: newRunDir(loaded.root),
        mode: chosen,
        video: video ?? loaded.config.video ?? "on",
      }
}

/**
 * Writes the run's report over whatever records were kept, says where it is, and resolves to its
 * path relative to `cwd` (undefined when nothing was kept).
 */
export async function closeRecording(
  recording: RecordSettings | undefined,
  cwd: string,
  write: (line: string) => void,
): Promise<string | undefined> {
  const report = recording && (await finishRun(recording.runDir))

  if (report === undefined) return undefined

  write(`report: ${relative(cwd, report)}`)

  return relative(cwd, report)
}
