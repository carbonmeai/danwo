/**
 * The tests pages' server functions: each reads the project's `.danwo` folder and its test list on
 * the server, and hands the page plain data. Nothing here writes.
 */
import { createServerFn } from "@tanstack/react-start"

import { projectRoot } from "../../lib/project-files.ts"
import type { KnownTest } from "../live/launch-args.ts"
import { knownTests } from "../live/launcher.ts"
import { loadHistory } from "../runs/runs-data.ts"
import { getTest } from "./test-data.ts"
import { listTests, readRecord } from "./tests-data.ts"

/** The project's tests from `danwo test --list`, or none when they cannot be listed. */
function known(root: string): Promise<readonly KnownTest[]> {
  return knownTests(root).catch(() => [])
}

export const fetchTests = createServerFn({ method: "GET" }).handler(async () => {
  const root = projectRoot()
  const [runs, tests] = await Promise.all([loadHistory(root), known(root)])

  return listTests(root, runs, tests)
})

export const fetchTest = createServerFn({ method: "GET" })
  .validator((input: { readonly id: string; readonly record?: string | undefined }) => input)
  .handler(async ({ data }) => {
    const root = projectRoot()
    const [runs, tests] = await Promise.all([loadHistory(root), known(root)])
    const file = tests.find((test) => test.id === data.id)?.file

    return getTest(root, runs, data.id, file, data.record)
  })

/** The test a kept record recorded, so an old record address can open on its test's page. */
export const fetchRecordTest = createServerFn({ method: "GET" })
  .validator((dir: string) => dir)
  .handler(async ({ data }) => (await readRecord(projectRoot(), data))?.test ?? null)
