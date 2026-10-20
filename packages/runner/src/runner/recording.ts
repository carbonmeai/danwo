/**
 * A run's flight recording as a whole: where its records go, and the report written over them when
 * the run ends. Each worker writes the records of its own attempts and trials.
 */
import { relative } from "node:path"

import type { VideoMode } from "../record/video.ts"
import type { LoadedConfig } from "./config.ts"
import { newRunDir, type RecordMode, type RecordOptions, type RecordSettings } from "./record.ts"
import { DEFAULT_KEEP_RUNS, finishRun } from "./report.ts"

/** The config's `record`, whichever form it takes, as an object. */
export function recordOptions(record: RecordMode | RecordOptions | undefined): RecordOptions {
  return typeof record === "string" ? { mode: record } : (record ?? {})
}

/** How many of the newest runs keep their recordings: the option, else the config, else 50. */
export function keepRunsOf(loaded: LoadedConfig, keepRuns?: number): number {
  return keepRuns ?? recordOptions(loaded.config.record).keepRuns ?? DEFAULT_KEEP_RUNS
}

/**
 * The run's recording settings: the option, else the config, else `always`; none when off.
 * Video follows the same order and defaults to `on`; so do the runs kept, defaulting to 50.
 */
export function openRecording(
  loaded: LoadedConfig,
  mode: RecordMode | undefined,
  video?: VideoMode,
  keepRuns?: number,
): RecordSettings | undefined {
  const chosen = mode ?? recordOptions(loaded.config.record).mode ?? "always"

  return chosen === "off"
    ? undefined
    : {
        runDir: newRunDir(loaded.root),
        mode: chosen,
        video: video ?? loaded.config.video ?? "on",
        keepRuns: keepRunsOf(loaded, keepRuns),
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
  const report = recording && (await finishRun(recording.runDir, recording.keepRuns))

  if (report === undefined) return undefined

  write(`report: ${relative(cwd, report)}`)

  return relative(cwd, report)
}
