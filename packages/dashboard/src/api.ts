/**
 * The dashboard's server functions: each reads the project's `.danwo` folder on the server and
 * hands the page plain data. Nothing here writes, and every path stays inside `.danwo`.
 */
import { createServerFn } from "@tanstack/react-start"

import { projectRoot } from "./data/files.ts"
import { getImpact } from "./data/impact.ts"
import { getInsights } from "./data/insights.ts"
import { getRecord, getScreenshot } from "./data/records.ts"
import { getRun, listRuns } from "./data/runs.ts"

export const fetchRuns = createServerFn({ method: "GET" })
  .validator((page: number) => page)
  .handler(({ data }) => listRuns(projectRoot(), data))

export const fetchRun = createServerFn({ method: "GET" })
  .validator((id: string) => id)
  .handler(async ({ data }) => (await getRun(projectRoot(), data)) ?? null)

export const fetchRecord = createServerFn({ method: "GET" })
  .validator((dir: string) => dir)
  .handler(async ({ data }) => (await getRecord(projectRoot(), data)) ?? null)

export const fetchScreenshot = createServerFn({ method: "GET" })
  .validator((input: { readonly dir: string; readonly file: string }) => input)
  .handler(({ data }) => getScreenshot(projectRoot(), data.dir, data.file))

export const fetchInsights = createServerFn({ method: "GET" }).handler(() =>
  getInsights(projectRoot()),
)

export const fetchImpact = createServerFn({ method: "GET" }).handler(() => getImpact(projectRoot()))
