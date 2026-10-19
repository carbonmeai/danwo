/**
 * The runs pages' server functions: each reads the project's `.danwo` folder on the server and hands
 * the page plain data. Nothing here writes.
 */
import { createServerFn } from "@tanstack/react-start"

import { projectRoot } from "../../lib/project-files.ts"
import { getRun, listRuns } from "./runs-data.ts"

export const fetchRuns = createServerFn({ method: "GET" })
  .validator((page: number) => page)
  .handler(({ data }) => listRuns(projectRoot(), data))

export const fetchRun = createServerFn({ method: "GET" })
  .validator((id: string) => id)
  .handler(async ({ data }) => (await getRun(projectRoot(), data)) ?? null)
