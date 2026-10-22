import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  createEmulator,
  type Emulator,
  github as githubEmulator,
  githubRepo,
  seedGithub,
} from "@danwo/emulators"
import type { RunOutcome } from "@danwo/matrix"
import type { MatrixRunReport, TestReport, TestRunReport } from "@danwo/runner/runner"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { github } from "../src/index.ts"
import {
  COMMENT_MARKER,
  commentBody,
  type CommentLinks,
  MAX_COMMENT,
  matrixSection,
  parseSections,
  testSection,
} from "../src/pr-comment.ts"

let dir: string
let logged: string[]

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "danwo-pr-comment-"))
  logged = []
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

/** Two GitHub tokens, put together at runtime so no scanner takes the source for a key. */
const ADA_TOKEN = ["ghp_", "adaAdaAdaAdaAdaAdaAdaAdaAdaAdaAda01"].join("")
const BOB_TOKEN = ["ghp_", "bobBobBobBobBobBobBobBobBobBobBob02"].join("")

const links = (over: Partial<CommentLinks> = {}): CommentLinks => ({
  runUrl: "https://github.example/acme/shop/actions/runs/77",
  artifact: "danwo-runs",
  reportUrl: undefined,
  sha: "headsha1234567",
  ...over,
})

const passed = (id: string, ms = 1500): TestReport => ({
  id,
  status: "passed",
  workerIndex: 0,
  attempts: [{ status: "passed", durationMs: ms, error: undefined }],
})

function failed(id: string, record?: string): TestReport {
  return {
    id,
    status: "failed",
    workerIndex: 0,
    attempts: [
      {
        status: "failed",
        durationMs: 2000,
        error: {
          code: "EXPECTATION_FAILED",
          class: "test",
          name: "AssertionError",
          message: "expected the order to read Paid | got Pending",
          source: { file: "tests/checkout.danwo.ts", line: 25 },
        },
        record,
        usage: {
          cache: {},
          spent: { calls: 3, retries: 0, tokens: [900, 120], usd: 0.0123 },
          steps: [],
        },
      },
    ],
  }
}

const flaky = (id: string): TestReport => ({
  id,
  status: "flaky",
  workerIndex: 0,
  attempts: [
    { status: "failed", durationMs: 900, error: undefined },
    { status: "passed", durationMs: 800, error: undefined },
  ],
})

function testRun(reports: TestReport[], over: Partial<TestRunReport> = {}): TestRunReport {
  return {
    kind: "test",
    root: dir,
    cwd: dir,
    reports,
    brokenFiles: [],
    durationMs: 12_300,
    reportPath: undefined,
    ...over,
  }
}

/** A provider call as a flight record keeps it, without bodies. */
const exchange = (
  method: string,
  host: string,
  path: string,
  status: number | null,
  fault: string | null,
) => ({
  id: `${method}${path}`,
  disposition: "routed",
  method,
  host,
  path,
  startedAt: "2026-10-19T10:00:00.000Z",
  client: "server",
  origin: "server",
  fault,
  status,
  durationMs: 12,
  aborted: false,
})

/** A flight record as `danwo test` keeps it, with the parts the comment reads. */
async function writeRecord(record: string): Promise<void> {
  await mkdir(join(dir, record), { recursive: true })
  await writeFile(
    join(dir, record, "record.json"),
    JSON.stringify({
      steps: [
        { index: 0, label: 'page.goto("/checkout")', status: "passed", events: [] },
        {
          index: 1,
          label: 'getByRole("button", name: "Pay").click()',
          status: "failed",
          source: { file: "tests/checkout.danwo.ts", line: 22 },
          error: { code: "EXPECTATION_FAILED", message: "no" },
          events: [],
        },
      ],
      exchanges: [
        { ...exchange("GET", "localhost", "/checkout", 200, null), origin: "page" },
        exchange("POST", "api.stripe.com", "/v1/customers", 200, null),
        exchange("POST", "api.stripe.com", "/v1/checkout/sessions?expand=x", 500, "status 500"),
      ],
    }),
  )
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

function matrixRun(over: Partial<MatrixRunReport> = {}): MatrixRunReport {
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
    record: ".danwo/runs/r2/buys-credits/duplicate",
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
    root: dir,
    cwd: dir,
    testId: "tests/buy-credits.danwo.ts › buys credits",
    file: "tests/buy-credits.danwo.ts",
    result: { clean: outcome({}), runs: [delayed, duplicate] },
    durationMs: 92_000,
    reportPath: undefined,
    judgedBy: "invariant",
    ...over,
  }
}

const count = (text: string, part: string) => text.split(part).length - 1

/** The report with every attempt given `verdict`. */
const withVerdict = (
  report: TestReport,
  verdict: NonNullable<TestReport["attempts"][0]["verdict"]>,
): TestReport => ({
  ...report,
  attempts: report.attempts.map((attempt) => ({ ...attempt, verdict })),
})

describe("the pull request comment's markdown", () => {
  it("heads the test section with counts, spend and commit, and lists failures first", async () => {
    const section = await testSection(
      testRun([
        passed("tests/a.danwo.ts › works"),
        failed("tests/checkout.danwo.ts › pays"),
        flaky("tests/b.danwo.ts › retries"),
      ]),
      links({ reportUrl: "https://reports.example/run/77" }),
    )
    const body = commentBody(undefined, section)
    const lines = body.split("\n")

    expect(body.startsWith(COMMENT_MARKER)).toBe(true)
    expect(lines).toContain("### ❌ danwo test · 1 passed · 1 failed · 1 flaky")
    expect(lines).toContain(
      "12.3 s · model $0.0123 · commit `headsha` · [workflow run](https://github.example/acme/shop/actions/runs/77)",
    )

    const rows = lines.filter((line) => /^\| (❌|✅|⚠️) \|/.test(line))

    expect(rows).toEqual([
      "| ❌ | [tests/checkout.danwo.ts › pays](https://reports.example/run/77) | 2.0 s | 0 |",
      "| ✅ | [tests/a.danwo.ts › works](https://reports.example/run/77) | 1.5 s | 0 |",
    ])
    expect(lines).toContain("<details><summary>⚠️ 1 flaky test: passed on a retry</summary>")
    expect(lines).toContain("| tests/b.danwo.ts › retries | 2 |")
    expect(count(body, "<details>")).toBe(count(body, "</details>"))
  })

  it("folds each failure with its step, error, last provider calls, faults and record", async () => {
    await writeRecord(".danwo/runs/r1/pays/attempt-1")

    const body = commentBody(
      undefined,
      await testSection(
        testRun([failed("tests/checkout.danwo.ts › pays", ".danwo/runs/r1/pays/attempt-1")]),
        links(),
      ),
    )
    const lines = body.split("\n")

    expect(lines).toContain(
      "<details><summary>❌ tests/checkout.danwo.ts › pays: EXPECTATION_FAILED</summary>",
    )
    expect(lines).toContain(
      "- **Error:** `EXPECTATION_FAILED` (test): expected the order to read Paid \\| got Pending (tests/checkout.danwo.ts:25)",
    )
    expect(lines).toContain(
      '- **Failing step:** `getByRole("button", name: "Pay").click() (tests/checkout.danwo.ts:22)`',
    )
    expect(lines).toContain("- **Last provider calls:**")
    expect(lines).toContain("  - `POST api.stripe.com/v1/customers → 200`")
    expect(lines).toContain(
      "  - `POST api.stripe.com/v1/checkout/sessions → 500 · fault: status 500`",
    )
    expect(body).not.toContain("localhost/checkout")
    expect(lines).toContain(
      "- **Faults:** `status 500 on POST api.stripe.com/v1/checkout/sessions`",
    )
    expect(lines).toContain(
      "- **Record:** `r1/pays/attempt-1` in the `danwo-runs` artifact of [this run](https://github.example/acme/shop/actions/runs/77#artifacts)",
    )
  })

  it("splits the failures by whose they are, and says why in each failure", async () => {
    const appBug = failed("tests/checkout.danwo.ts › pays")
    const testIssue = failed("tests/sign-in.danwo.ts › signs in")
    const body = commentBody(
      undefined,
      await testSection(
        testRun([
          withVerdict(appBug, {
            verdict: "app",
            confidence: "certain",
            reason: "the app answered POST 127.0.0.1:3000/buy with 500, then EXPECTATION_FAILED",
          }),
          withVerdict(testIssue, {
            verdict: "test",
            confidence: "likely",
            reason: "LOCATOR_NOT_FOUND on a page that loaded with no app errors",
          }),
        ]),
        links(),
      ),
    )
    const lines = body.split("\n")

    expect(lines).toContain("### ❌ danwo test · 0 passed · 2 failed (1 app bug · 1 test issue)")
    expect(lines).toContain(
      "<details><summary>❌ tests/sign-in.danwo.ts › signs in: EXPECTATION_FAILED · Test issue (likely)</summary>",
    )
    expect(lines).toContain(
      "- **Whose:** App bug: the app answered POST 127.0.0.1:3000/buy with 500, then EXPECTATION_FAILED",
    )
  })

  it("gives a matrix its verdict and a row per fault that did not hold", () => {
    const body = commentBody(undefined, matrixSection(matrixRun(), links()))
    const lines = body.split("\n")

    expect(lines).toContain("### ❌ danwo matrix · tests/buy-credits.danwo.ts › buys credits")
    expect(lines).toContain("**The invariant broke under 1 of 2 faults.**")
    expect(lines.filter((line) => line.startsWith("| ❌") || line.startsWith("| ✅"))).toEqual([
      "| ❌ | duplicate on webhook checkout.session.completed | invariant: expected 1000 to be 500 |",
    ])
    expect(lines).toContain(
      "- duplicate on webhook checkout.session.completed: `r2/buys-credits/duplicate`",
    )
  })

  it("says when every fault held, and when the clean run failed", () => {
    const held = matrixRun({
      result: { clean: outcome({}), runs: [outcome({ fault: null }), outcome({ fault: null })] },
    })
    const broken = matrixRun({ result: { clean: outcome({ status: "failed" }), runs: [] } })

    expect(commentBody(undefined, matrixSection(held, links()))).toContain(
      "**The invariant held under all 2 faults.**",
    )
    expect(commentBody(undefined, matrixSection(broken, links()))).toContain(
      "**The clean run failed: no faults were planned.**",
    )
  })
})

describe("editing the comment", () => {
  it("replaces a run's own section, keeps the others for the same commit, and puts the test first", async () => {
    const first = commentBody(undefined, matrixSection(matrixRun(), links()))
    const second = commentBody(
      first,
      await testSection(testRun([passed("tests/a.danwo.ts › works")]), links()),
    )
    const third = commentBody(
      second,
      await testSection(testRun([failed("tests/a.danwo.ts › works")]), links()),
    )

    expect(parseSections(third).map((s) => s.key)).toEqual([
      "test",
      expect.stringMatching(/^matrix:/),
    ])
    expect(third).toContain("### ❌ danwo test · 0 passed · 1 failed")
    expect(third).not.toContain("### ✅ danwo test")
    expect(count(third, COMMENT_MARKER)).toBe(1)
  })

  it("drops sections from an older commit", async () => {
    const old = commentBody(undefined, matrixSection(matrixRun(), links({ sha: "oldsha00000" })))
    const fresh = commentBody(
      old,
      await testSection(testRun([passed("tests/a.danwo.ts › x")]), links()),
    )

    expect(parseSections(fresh).map((s) => s.key)).toEqual(["test"])
    expect(fresh).not.toContain("danwo matrix")
  })

  it("stays under GitHub's limit, cutting between entries with a note", async () => {
    const many = Array.from({ length: 3000 }, (_, i) => failed(`tests/big.danwo.ts › case ${i}`))
    const body = commentBody(undefined, await testSection(testRun(many), links()))

    expect(body.length).toBeLessThanOrEqual(MAX_COMMENT)
    expect(body).toMatch(/_…\d+ more entries cut to fit GitHub's comment limit/)
    expect(count(body, "<details>")).toBe(count(body, "</details>"))
    expect(body.trimEnd().endsWith("</sub>")).toBe(true)
  })
})

/** A GitHub emulator with `acme/shop`, its people's tokens, and pull request 1 open. */
async function shopOnGitHub(): Promise<Emulator> {
  const emulator = createEmulator(githubEmulator)

  seedGithub(emulator.store, {
    users: [{ login: "ada" }, { login: "bob" }],
    orgs: [{ login: "acme", members: ["ada"] }],
    repos: [{ repo: "acme/shop", private: true, files: { "README.md": "# shop\n" } }],
    tokens: [
      { token: ADA_TOKEN, login: "ada", scopes: ["repo"] },
      { token: BOB_TOKEN, login: "bob", scopes: ["public_repo"] },
    ],
  })

  const opened = await emulator.fetch(
    new Request("https://api.github.com/repos/acme/shop/issues", {
      method: "POST",
      headers: {
        authorization: `Bearer ${ADA_TOKEN}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ title: "Add credits" }),
    }),
  )

  expect(opened.status).toBe(201)

  return emulator
}

/** An Actions job on pull request 1 of `acme/shop`, with `token`. */
async function pullRequestEnv(token: string): Promise<Record<string, string>> {
  const event = join(dir, "event.json")

  await writeFile(
    event,
    JSON.stringify({ pull_request: { number: 1, head: { sha: "headsha1234567" } } }),
  )

  return {
    GITHUB_ACTIONS: "true",
    GITHUB_API_URL: "https://api.github.com",
    GITHUB_SERVER_URL: "https://github.example",
    GITHUB_REPOSITORY: "acme/shop",
    GITHUB_SHA: "mergesha456",
    GITHUB_EVENT_PATH: event,
    GITHUB_RUN_ID: "77",
    GITHUB_TOKEN: token,
  }
}

const viaEmulator =
  (emulator: Emulator): typeof fetch =>
  async (input, init) =>
    emulator.fetch(new Request(input, init))

describe("github reporter on a pull request", () => {
  it("posts one comment and edits it as later runs finish", async () => {
    const emulator = await shopOnGitHub()
    const env = await pullRequestEnv(ADA_TOKEN)
    const reporter = () =>
      github({ env, fetch: viaEmulator(emulator), log: (line) => logged.push(line) })

    await reporter().testsFinished?.(testRun([failed("tests/a.danwo.ts › pays")]))
    await reporter().matrixFinished?.(matrixRun())
    await reporter().testsFinished?.(testRun([passed("tests/a.danwo.ts › pays")]))

    const comments = githubRepo(emulator, "acme/shop").comments(1)

    expect(comments).toHaveLength(1)
    expect(comments[0]?.author).toBe("ada")
    expect(comments[0]?.body).toContain("### ✅ danwo test · 1 passed · 0 failed")
    expect(comments[0]?.body).toContain("**The invariant broke under 1 of 2 faults.**")
    expect(logged.filter((line) => line.includes("comment"))).toEqual([])
  })

  it("leaves the comment to merge-reports on a shard, and posts the merged run", async () => {
    const emulator = await shopOnGitHub()
    const env = await pullRequestEnv(ADA_TOKEN)
    const reporter = github({ env, fetch: viaEmulator(emulator), log: (line) => logged.push(line) })

    await reporter.testsFinished?.(testRun([passed("tests/a.danwo.ts › x")], { shard: "1/2" }))

    expect(githubRepo(emulator, "acme/shop").comments(1)).toEqual([])
    expect(logged).toContain(
      "github: shard 1/2: the pull request comment comes from danwo merge-reports",
    )

    await reporter.testsFinished?.(
      testRun([passed("tests/a.danwo.ts › x"), passed("tests/b.danwo.ts › y")]),
    )

    expect(githubRepo(emulator, "acme/shop").comments(1)[0]?.body).toContain(
      "### ✅ danwo test · 2 passed · 0 failed",
    )
  })

  it("says once what permission is missing, and stops trying", async () => {
    const emulator = await shopOnGitHub()
    const env = await pullRequestEnv(BOB_TOKEN)
    const reporter = github({ env, fetch: viaEmulator(emulator), log: (line) => logged.push(line) })

    await reporter.testsFinished?.(testRun([passed("tests/a.danwo.ts › x")]))
    await reporter.matrixFinished?.(matrixRun())

    const warnings = logged.filter((line) => line.startsWith("github: no pull request comment"))

    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toMatch(/give the workflow "permissions: pull-requests: write"$/)
  })

  it("posts nothing when turned off", async () => {
    const emulator = await shopOnGitHub()
    const env = {
      ...(await pullRequestEnv(ADA_TOKEN)),
      DANWO_PR_COMMENT: "off",
    }

    await github({
      env,
      fetch: viaEmulator(emulator),
      log: (line) => logged.push(line),
    }).testsFinished?.(testRun([passed("tests/a.danwo.ts › x")]))
    await github({
      env: { ...env, DANWO_PR_COMMENT: "" },
      prComment: false,
      fetch: viaEmulator(emulator),
      log: (line) => logged.push(line),
    }).testsFinished?.(testRun([passed("tests/a.danwo.ts › x")]))

    expect(githubRepo(emulator, "acme/shop").comments(1)).toEqual([])
  })
})
