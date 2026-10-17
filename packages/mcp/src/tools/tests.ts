/** `list_tests` and `run_tests`: what the project tests, and running some of it. */
import { resolve } from "node:path"

import type { AttemptReport, TestReport, TestRunReport } from "@danwo/runner/runner"
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"

import type { ListedTest } from "../jobs/protocol.ts"
import { runJob } from "../jobs/run.ts"
import type { Project } from "../project.ts"
import { failingStep, loadRecord, modelCalls } from "../records.ts"
import { answer, progressOf, text } from "../reply.ts"
import { oneLine, seconds, sourceText } from "../text.ts"

const MARK: Readonly<Record<string, string>> = {
  passed: "✓",
  flaky: "~",
  failed: "✗",
  "timed-out": "✗",
  interrupted: "✗",
  skipped: "-",
}

/** A regular expression matching any of `names` exactly within a test id. */
function namesPattern(names: readonly string[]): string {
  return names.map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")
}

function listing(root: string, tests: readonly ListedTest[]): string[] {
  const byFile = Map.groupBy(tests, (test) => test.file)
  const lines = [`${tests.length} tests under ${root}`]

  for (const [file, inFile] of byFile) {
    lines.push(file)

    for (const test of inFile) {
      const title = test.id.slice(file.length + 3)
      const flags = [test.mode === "normal" ? "" : test.mode, test.invariant ? "invariant" : ""]
        .filter((flag) => flag !== "")
        .map((flag) => ` [${flag}]`)
        .join("")

      lines.push(`  ${title}${flags}`)
    }
  }

  return lines
}

/** A test's last attempt's record, read for its failing step and model calls. */
async function lastRecord(project: Project, attempt: AttemptReport | undefined) {
  if (attempt?.record === undefined) return undefined

  const dir = project.relative(resolve(project.place.cwd, attempt.record))

  return loadRecord(project, dir).catch(() => undefined)
}

type Loaded = Awaited<ReturnType<typeof lastRecord>>

/** Why the last attempt failed: its failing step, its error and where its record is. */
function whyFailed(attempt: AttemptReport | undefined, loaded: Loaded): string[] {
  const step = loaded === undefined ? undefined : failingStep(loaded.record)
  const error = attempt?.error
  const at = error?.source ? ` (at ${sourceText(error.source)})` : ""
  const lines = [
    step && `failing step: #${step.index} ${oneLine(step.label, 200)} ${sourceText(step.source)}`,
    error && `error ${error.code}: ${oneLine(error.message, 600)}${at}`,
    loaded && `record: ${loaded.dir} (show_run, read_screenshot)`,
  ]

  return lines.filter((part) => typeof part === "string").map((part) => `    ${part}`)
}

async function testLines(project: Project, report: TestReport): Promise<string[]> {
  const last = report.attempts.at(-1)
  const loaded = await lastRecord(project, last)
  const tries = `${report.attempts.length} attempt${report.attempts.length === 1 ? "" : "s"}`
  const calls = loaded === undefined ? "" : `, ${modelCalls(loaded.record)} model calls`
  const head = `${MARK[report.status] ?? "?"} ${report.id} (${tries}${calls})`

  return MARK[report.status] === "✗" ? [head, ...whyFailed(last, loaded)] : [head]
}

function summaryLine(report: TestRunReport): string {
  const count = (status: string) => report.reports.filter((r) => r.status === status).length
  const failed = report.reports.filter((r) => MARK[r.status] === "✗").length

  return `${count("passed")} passed · ${failed} failed · ${count("flaky")} flaky · ${count("skipped")} skipped in ${seconds(report.durationMs)}`
}

async function runLines(project: Project, report: TestRunReport): Promise<string[]> {
  const tests = await Promise.all(report.reports.map((r) => testLines(project, r)))

  return [
    summaryLine(report),
    ...tests.flat(),
    ...report.brokenFiles.map(
      (broken) => `✗ ${broken.file} did not run: ${oneLine(broken.error, 600)}`,
    ),
    ...(report.reportPath
      ? [`report: ${project.relative(resolve(project.place.cwd, report.reportPath))}`]
      : []),
  ]
}

export function registerTestTools(server: McpServer, project: Project): void {
  server.registerTool(
    "list_tests",
    {
      description:
        "List the project's danwo tests by file, with their mode (skip/only) and whether they declare an invariant.",
      annotations: { readOnlyHint: true },
    },
    () =>
      answer(async () => {
        const { root, tests } = await runJob(project.place, { kind: "list" })

        return text(listing(root, tests))
      }),
  )

  server.registerTool(
    "run_tests",
    {
      description:
        "Run danwo tests (all, or narrowed by file, grep or test names). Reports pass/fail per test; for failures, the failing step, error with its test file line, and the flight record to open with show_run or read_screenshot. Sends progress lines while running; cancellable.",
      inputSchema: {
        files: z.array(z.string()).optional().describe("test file paths or path fragments"),
        grep: z.string().optional().describe("regular expression over test ids (file › title)"),
        tests: z.array(z.string()).optional().describe("test titles or ids to run"),
        record: z
          .enum(["always", "on-failure", "off"])
          .optional()
          .describe("flight recorder mode (default always, so every test reports its model calls)"),
      },
    },
    (args, extra) =>
      answer(async () => {
        const grep = args.tests?.length ? namesPattern(args.tests) : args.grep
        const { report } = await runJob(
          project.place,
          { kind: "test", patterns: args.files ?? [], grep, record: args.record ?? "always" },
          { onLine: progressOf(extra), signal: extra.signal },
        )

        return text(report === undefined ? "No tests found." : await runLines(project, report))
      }),
  )
}
