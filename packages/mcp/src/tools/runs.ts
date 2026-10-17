/** `show_run` and `read_screenshot`: what a recorded run did, from its flight records. */
import { readFile } from "node:fs/promises"
import { join } from "node:path"

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"

import type { Project } from "../project.ts"
import { type LoadedRun, loadRecord, loadRun, runLabel } from "../records.ts"
import { answer, text } from "../reply.ts"
import { timelineOf } from "../timeline.ts"

/** Failed records shown in full; the rest of the failures are listed by name. */
const DETAILED = 3

/** A run as text: its failures in detail, or a line saying everything passed. */
export async function runSummary(project: Project, run: LoadedRun, test?: string): Promise<string> {
  const records = run.records.filter((r) => test === undefined || r.record.test.includes(test))
  const failed = records.filter((r) => r.record.status !== "passed")
  const head = `run ${run.id}: ${records.length} records, ${failed.length} failed · report ${run.dir}/report.html`

  if (failed.length === 0) return `${head}\nevery recorded run passed`

  const detailed = await Promise.all(
    failed.slice(0, DETAILED).map(async (r) => (await timelineOf(project, r)).join("\n")),
  )
  const others = failed
    .slice(DETAILED)
    .map((r) => `also failed: ${r.record.test} · ${runLabel(r.record)} · record ${r.dir}`)

  return [head, ...detailed, ...others].join("\n\n")
}

async function screenshotPath(project: Project, record: string, step: number | undefined) {
  const loaded = await loadRecord(project, record)
  const file =
    step === undefined
      ? loaded.record.failure?.screenshot
      : loaded.record.steps.find((s) => s.index === step)?.screenshot

  if (file === undefined) {
    throw new Error(
      step === undefined
        ? `${record} has no screenshot at failure`
        : `step #${step} of ${record} has no screenshot (steps with one are marked "screenshot" in show_run)`,
    )
  }

  return project.inside(join(loaded.dir, file))
}

export function registerRunTools(server: McpServer, project: Project): void {
  server.registerTool(
    "show_run",
    {
      description:
        "Explain a recorded run (the newest by default): for each failed test or fault run, the error and its test file line, the steps, console errors, failed or faulted network calls, webhook deliveries and emulator state. Secrets are redacted.",
      inputSchema: {
        run: z.string().optional().describe("a run id under .danwo/runs; default the newest"),
        test: z.string().optional().describe("only records whose test id contains this"),
      },
      annotations: { readOnlyHint: true },
    },
    (args) =>
      answer(async () => {
        const run = await loadRun(project, args.run)

        if (run === undefined)
          return text(args.run ? `no recorded run ${args.run}` : "no recorded runs yet")

        return text(await runSummary(project, run, args.test))
      }),
  )

  server.registerTool(
    "read_screenshot",
    {
      description:
        "A screenshot from a flight record: the screen at failure (default), or the one taken right after a step.",
      inputSchema: {
        record: z.string().describe("the record directory show_run or run_tests named"),
        step: z.number().int().nonnegative().optional().describe("a step's # from show_run"),
      },
      annotations: { readOnlyHint: true },
    },
    (args) =>
      answer(async () => {
        const path = await screenshotPath(project, args.record, args.step)
        const data = (await readFile(path)).toString("base64")

        return { content: [{ type: "image", data, mimeType: "image/png" }] }
      }),
  )
}
