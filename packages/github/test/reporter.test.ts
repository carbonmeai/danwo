import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { RunOutcome } from "@danwo/core"
import type { MatrixRunReport, TestReport, TestRunReport } from "@danwo/runner/runner"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { github } from "../src/index.ts"
import { type FakeGitHub, startFakeGitHub } from "./fake-github.ts"

let dir: string
let fake: FakeGitHub | undefined
let logged: string[]

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "danwo-github-"))
  logged = []
})

afterEach(async () => {
  await fake?.close()
  fake = undefined
  await rm(dir, { recursive: true, force: true })
})

/** The environment of an Actions job on a pull request, with the project in `app/`. */
async function actionsEnv(api: string): Promise<Record<string, string>> {
  const event = join(dir, "event.json")

  await writeFile(event, JSON.stringify({ pull_request: { head: { sha: "headsha123" } } }))

  return {
    GITHUB_ACTIONS: "true",
    GITHUB_API_URL: api,
    GITHUB_SERVER_URL: "https://github.example",
    GITHUB_REPOSITORY: "acme/shop",
    GITHUB_SHA: "mergesha456",
    GITHUB_EVENT_PATH: event,
    GITHUB_RUN_ID: "77",
    GITHUB_TOKEN: "ghs_testtoken",
    GITHUB_WORKSPACE: dir,
    GITHUB_STEP_SUMMARY: join(dir, "summary.md"),
  }
}

function failed(id: string, line: number, record?: string): TestReport {
  return {
    id,
    status: "failed",
    workerIndex: 0,
    attempts: [
      {
        status: "failed",
        durationMs: 20,
        error: {
          code: "AssertionError",
          message: `expected "Paid" | key REDACTED-TEST-VALUE`,
          source: { file: "tests/checkout.danwo.ts", line },
        },
        record,
      },
    ],
  }
}

function testRun(reports: TestReport[]): TestRunReport {
  return {
    kind: "test",
    root: join(dir, "app"),
    cwd: join(dir, "app"),
    reports,
    brokenFiles: [],
    durationMs: 1234,
    reportPath: ".danwo/runs/r1/report.html",
  }
}

const outcome = (over: Partial<RunOutcome>): RunOutcome => ({
  fault: null,
  status: "passed",
  error: null,
  exchanges: [],
  deliveries: [],
  notes: [],
  ...over,
})

function matrixRun(): MatrixRunReport {
  const duplicate = outcome({
    status: "failed",
    fault: {
      target: "webhook",
      topic: "checkout.session.completed",
      occurrence: 0,
      fault: { kind: "duplicate" },
      label: "duplicate on webhook checkout.session.completed",
    },
    error: "invariant: expected 1000 to be 500",
    notes: ["body stopped at tests/buy-credits.danwo.ts:25"],
    record: ".danwo/runs/r2/buys-credits/duplicate",
    source: { file: "tests/buy-credits.danwo.ts", line: 31 },
  })
  const delayed = outcome({
    fault: {
      target: "webhook",
      topic: "checkout.session.completed",
      occurrence: 0,
      fault: { kind: "delay", ms: 600_000 },
      label: "delay 600000ms on webhook checkout.session.completed",
    },
  })

  return {
    kind: "matrix",
    root: join(dir, "app"),
    cwd: join(dir, "app"),
    testId: "tests/buy-credits.danwo.ts › buys credits",
    file: "tests/buy-credits.danwo.ts",
    result: { clean: outcome({}), runs: [delayed, duplicate] },
    durationMs: 92_000,
    reportPath: ".danwo/runs/r2/report.html",
  }
}

const reporterWith = (env: Record<string, string>) =>
  github({ env, log: (line) => logged.push(line) })

describe("github reporter for danwo test", () => {
  it("opens a check on the PR head, annotates in batches of 50, then completes it", async () => {
    fake = await startFakeGitHub()
    const reporter = reporterWith(await actionsEnv(fake.url))
    const reports = Array.from({ length: 60 }, (_, i) =>
      failed(`tests/checkout.danwo.ts › case ${i}`, 10 + i, `.danwo/runs/r1/case-${i}/attempt-1`),
    )

    await reporter.started?.({ kind: "test", root: join(dir, "app"), cwd: join(dir, "app") })
    await reporter.testsFinished?.(testRun(reports))

    expect(fake.requests.map((r) => `${r.method} ${r.path}`)).toEqual([
      "POST /repos/acme/shop/check-runs",
      "PATCH /repos/acme/shop/check-runs/4242",
      "PATCH /repos/acme/shop/check-runs/4242",
    ])

    const [create, update, complete] = fake.requests

    expect(create?.authorization).toBe("Bearer ghs_testtoken")
    expect(create?.body).toMatchObject({
      name: "danwo",
      head_sha: "headsha123",
      status: "in_progress",
      details_url: "https://github.example/acme/shop/actions/runs/77",
    })

    const annotationsOf = (body: Record<string, unknown> | undefined) => {
      const output = body?.["output"] as { annotations?: unknown[] } | undefined

      return output?.annotations ?? []
    }

    expect(annotationsOf(update?.body)).toHaveLength(50)
    expect(annotationsOf(complete?.body)).toHaveLength(10)
    expect(annotationsOf(update?.body)[0]).toMatchObject({
      path: "app/tests/checkout.danwo.ts",
      start_line: 10,
      end_line: 10,
      annotation_level: "failure",
      title: "tests/checkout.danwo.ts › case 0",
    })
    expect(complete?.body).toMatchObject({
      status: "completed",
      conclusion: "failure",
      output: { title: "0 passed · 60 failed · 0 flaky · 0 skipped" },
    })
  })

  it("writes a summary with the failure table, record folders and the artifact link", async () => {
    fake = await startFakeGitHub()
    const env = await actionsEnv(fake.url)
    const reporter = reporterWith(env)

    await reporter.testsFinished?.(
      testRun([failed("tests/checkout.danwo.ts › pays", 25, ".danwo/runs/r1/pays/attempt-1")]),
    )

    const summary = await readFile(join(dir, "summary.md"), "utf8")

    expect(summary).toContain("### danwo test: 0 passed · 1 failed · 0 flaky · 0 skipped in 1.2 s")
    expect(summary).toContain(
      '| ❌ | tests/checkout.danwo.ts › pays | 1 | AssertionError: expected "Paid" \\| key sk_live_[redacted] (tests/checkout.danwo.ts:25) |',
    )
    expect(summary).toContain(
      "download the `danwo-runs` artifact from [this run](https://github.example/acme/shop/actions/runs/77#artifacts)",
    )
    expect(summary).toContain("- tests/checkout.danwo.ts › pays: `r1/pays/attempt-1`")
    expect(JSON.stringify(fake.requests)).not.toContain("REDACTED-TEST-VALUE")
  })

  it("completes a passing run as a success with no annotations", async () => {
    fake = await startFakeGitHub()
    const reporter = reporterWith(await actionsEnv(fake.url))
    const passed: TestReport = {
      id: "tests/a.danwo.ts › works",
      status: "passed",
      workerIndex: 0,
      attempts: [{ status: "passed", durationMs: 5, error: undefined }],
    }

    await reporter.testsFinished?.(testRun([passed]))

    expect(fake.requests.at(-1)?.body).toMatchObject({
      conclusion: "success",
      output: { annotations: [] },
    })
  })

  it("warns and carries on when the token may not write checks", async () => {
    fake = await startFakeGitHub("deny")
    const reporter = reporterWith(await actionsEnv(fake.url))

    await reporter.started?.({ kind: "test", root: dir, cwd: dir })
    await reporter.testsFinished?.(testRun([failed("tests/a.danwo.ts › x", 3)]))

    expect(fake.requests).toHaveLength(1)
    expect(logged).toEqual([
      'github: no check run: GitHub refused the check run (403: Resource not accessible by integration); give the workflow "permissions: checks: write"',
    ])
    expect(await readFile(join(dir, "summary.md"), "utf8")).toContain("1 failed")
  })

  it("says it is not in Actions and sends nothing", async () => {
    const reporter = reporterWith({})

    await reporter.started?.({ kind: "test", root: dir, cwd: dir })
    await reporter.testsFinished?.(testRun([failed("tests/a.danwo.ts › x", 3)]))

    expect(logged).toEqual(["github: not running in GitHub Actions; no check run or job summary"])
  })
})

describe("github reporter for danwo matrix", () => {
  it("names the check, lists failing faults first, and annotates the invariant's line", async () => {
    fake = await startFakeGitHub()
    const reporter = reporterWith(await actionsEnv(fake.url))

    await reporter.started?.({ kind: "matrix", root: join(dir, "app"), cwd: join(dir, "app") })
    await reporter.matrixFinished?.(matrixRun())

    const [create, complete] = fake.requests
    const output = complete?.body["output"] as { summary: string; annotations: unknown[] }

    expect(create?.body).toMatchObject({ name: "danwo matrix" })
    expect(complete?.body).toMatchObject({
      conclusion: "failure",
      output: { title: "faults: 1 passed · 1 failed" },
    })
    expect(output.annotations).toEqual([
      {
        path: "app/tests/buy-credits.danwo.ts",
        start_line: 31,
        end_line: 31,
        annotation_level: "failure",
        title: "failed: duplicate on webhook checkout.session.completed",
        message:
          "body stopped at tests/buy-credits.danwo.ts:25\ninvariant: expected 1000 to be 500",
      },
    ])

    const rows = output.summary
      .split("\n")
      .filter((line) => line.startsWith("| ❌") || line.startsWith("| ✅"))

    expect(rows).toEqual([
      "| ❌ | duplicate on webhook checkout.session.completed | body stopped at tests/buy-credits.danwo.ts:25 · invariant: expected 1000 to be 500 |",
      "| ✅ | clean run |  |",
      "| ✅ | delay 600000ms on webhook checkout.session.completed |  |",
    ])
    expect(output.summary).toContain(
      "- duplicate on webhook checkout.session.completed: `r2/buys-credits/duplicate`",
    )
  })
})
