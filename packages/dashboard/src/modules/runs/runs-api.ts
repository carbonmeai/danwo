/**
 * The runs pages' server functions: each reads the project's `.danwo` folder on the server and hands
 * the page plain data. Nothing here writes.
 */
import { createServerFn } from "@tanstack/react-start"

import { projectRoot } from "../../lib/project-files.ts"
import { getRunWithRecordings, listRuns, recordingOrigin, type RunFilter } from "./runs-data.ts"

export const fetchRuns = createServerFn({ method: "GET" })
  .validator((input: { readonly page: number; readonly filter: RunFilter }) => input)
  .handler(({ data }) => listRuns(projectRoot(), data.page, undefined, data.filter))

export const fetchRun = createServerFn({ method: "GET" })
  .validator((id: string) => id)
  .handler(async ({ data }) => (await getRunWithRecordings(projectRoot(), data)) ?? null)

/** Where a recording that is gone came from, so its overlay can say so and offer a rerun. */
export const fetchRecordingOrigin = createServerFn({ method: "GET" })
  .validator((dir: string) => dir)
  .handler(async ({ data }) => (await recordingOrigin(projectRoot(), data)) ?? null)
