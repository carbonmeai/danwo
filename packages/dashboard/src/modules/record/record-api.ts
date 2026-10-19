/**
 * The flight record page's server functions. Every path stays inside `.danwo/records`, and nothing
 * here writes.
 */
import { createServerFn } from "@tanstack/react-start"

import { projectRoot } from "../../lib/project-files.ts"
import { getRecord, getScreenshot } from "./record-data.ts"

export const fetchRecord = createServerFn({ method: "GET" })
  .validator((dir: string) => dir)
  .handler(async ({ data }) => (await getRecord(projectRoot(), data)) ?? null)

export const fetchScreenshot = createServerFn({ method: "GET" })
  .validator((input: { readonly dir: string; readonly file: string }) => input)
  .handler(({ data }) => getScreenshot(projectRoot(), data.dir, data.file))
