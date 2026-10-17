/** `run_matrix`: one test, clean and then once per planned fault, each judged by its invariant. */
import { resolve } from "node:path"

import type { MatrixRunReport } from "@danwo/runner/runner"
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"

import { runJob } from "../jobs/run.ts"
import type { Project } from "../project.ts"
import { answer, progressOf, text } from "../reply.ts"
import { capped, oneLine, seconds } from "../text.ts"

type Outcome = MatrixRunReport["result"]["clean"]

const MARK: Readonly<Record<Outcome["status"], string>> = {
  passed: "✓",
  failed: "✗",
  invalid: "?",
  "environment-error": "!",
}

function outcomeLine(project: Project, outcome: Outcome): string {
  const label = outcome.fault === null ? "clean run" : outcome.fault.label
  const record =
    outcome.record === undefined
      ? ""
      : ` · record ${project.relative(resolve(project.place.cwd, outcome.record))}`
  const error = outcome.error === null ? "" : `: ${oneLine(outcome.error, 400)}`

  return `${MARK[outcome.status]} ${label}${error}${record}`
}

function matrixLines(project: Project, report: MatrixRunReport): string[] {
  const { clean, runs } = report.result
  const count = (status: Outcome["status"]) => runs.filter((r) => r.status === status).length
  const passed = runs.filter((r) => r.status === "passed")

  return [
    `matrix ${report.testId}: ${count("passed")} passed · ${count("failed")} failed · ${count("invalid")} invalid · ${count("environment-error")} environment errors in ${seconds(report.durationMs)}`,
    outcomeLine(project, clean),
    ...runs.filter((r) => r.status !== "passed").map((r) => outcomeLine(project, r)),
    ...capped(passed, (r) => outcomeLine(project, r), 30),
    ...(clean.status === "passed" ? [] : ["the clean run must pass before any fault is tried"]),
  ]
}

export function registerMatrixTool(server: McpServer, project: Project): void {
  server.registerTool(
    "run_matrix",
    {
      description:
        "Run danwo's fault matrix on one test: a clean run, then one run per planned fault (provider errors, dropped connections, duplicate or late webhooks…), each judged by the test's invariant. Reports each fault's verdict, failures first. Slow; sends progress lines; cancellable.",
      inputSchema: {
        file: z.string().describe("the test file, relative to the project"),
        grep: z.string().optional().describe("selects the test when the file has several"),
        faults: z
          .string()
          .optional()
          .describe(
            'regular expression over fault labels, e.g. "duplicate|reset"; default every planned fault',
          ),
      },
    },
    (args, extra) =>
      answer(async () => {
        const file = project.inside(args.file)
        const { report } = await runJob(
          project.place,
          { kind: "matrix", file, grep: args.grep, faults: args.faults },
          { onLine: progressOf(extra), signal: extra.signal },
        )

        return text(
          report === undefined
            ? "The matrix stopped before it had a result."
            : matrixLines(project, report),
        )
      }),
  )
}
