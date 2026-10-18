import type { LintFinding, TestRunReport } from "@danwo/runner/runner"
import { describe, expect, it } from "vitest"

import { testAnnotations } from "../src/annotations.ts"
import { testSummary } from "../src/summary.ts"

const FINDING: LintFinding = {
  rule: "stripe/idempotency-key",
  severity: "warning",
  provider: "stripe",
  message: "POST api.stripe.com/v1/refunds was sent without an Idempotency-Key",
  hint: "Send a key derived from your own order id.",
  docs: "danwo guide lint#stripe-idempotency-key",
  evidence: { source: { file: "tests/refund.danwo.ts", line: 12 } },
}

/** A passing run whose two attempts found the same finding. */
const RUN: TestRunReport = {
  kind: "test",
  root: "/repo",
  cwd: "/repo",
  durationMs: 1200,
  reportPath: undefined,
  brokenFiles: [],
  reports: [
    {
      id: "tests/refund.danwo.ts › refunds",
      status: "passed",
      workerIndex: 0,
      attempts: [
        { status: "passed", error: undefined, durationMs: 600, lint: [FINDING] },
        { status: "passed", error: undefined, durationMs: 600, lint: [FINDING] },
      ],
    },
  ],
}

describe("integration lint on GitHub", () => {
  it("annotates each finding once, at warning level, on its test line", () => {
    const annotations = testAnnotations({ root: "/repo", workspace: "/repo" }, RUN)

    expect(annotations).toEqual([
      {
        path: "tests/refund.danwo.ts",
        start_line: 12,
        end_line: 12,
        annotation_level: "warning",
        title: "integration lint: stripe/idempotency-key",
        message: `${FINDING.message}\n${FINDING.hint}`,
      },
    ])
  })

  it("lists the findings in the summary", () => {
    const summary = testSummary(RUN, {
      artifact: "danwo-runs",
      runUrl: "https://github.com/o/r/actions/runs/1",
    })

    expect(summary).toContain("**Integration lint**: 1 finding")
    expect(summary).toContain("| warning | `stripe/idempotency-key` |")
  })
})
