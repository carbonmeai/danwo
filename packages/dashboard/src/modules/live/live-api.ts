/**
 * The live runs' server functions: a run as it stands, and starting, cancelling or unqueueing runs.
 * Every input is checked here; a test is only ever named by an id the project has.
 */
import { createServerFn } from "@tanstack/react-start"

import { projectRoot } from "../../lib/project-files.ts"
import { requestOf } from "./launch-args.ts"
import { cancelRun, dropQueued, startRun } from "./launcher.ts"
import { isRunId, liveRun } from "./live-data.ts"

function runIdOf(value: unknown): string {
  if (typeof value !== "string" || !isRunId(value)) throw new Error("expected a run id")

  return value
}

export const fetchLiveRun = createServerFn({ method: "GET" })
  .validator((id: string) => id)
  .handler(async ({ data }) =>
    isRunId(data) ? ((await liveRun(projectRoot(), data)) ?? null) : null,
  )

export const startRunFn = createServerFn({ method: "POST" })
  .validator((value: unknown) => requestOf(value))
  .handler(({ data }) => startRun(projectRoot(), data))

export const cancelRunFn = createServerFn({ method: "POST" })
  .validator((value: unknown) => runIdOf(value))
  .handler(({ data }) => cancelRun(projectRoot(), data))

export const dropQueuedFn = createServerFn({ method: "POST" })
  .validator((value: unknown) => {
    if (typeof value !== "number" || !Number.isInteger(value))
      throw new Error("expected a position")

    return value
  })
  .handler(({ data }) => {
    dropQueued(data)

    return { dropped: true }
  })
