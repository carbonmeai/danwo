import { fileURLToPath } from "node:url"

import { describe, expect, it } from "vitest"

import {
  failureVerdict,
  fixAdvice,
  stackFiles,
  type VerdictCall,
  type VerdictEvidence,
  verdictSummary,
} from "../src/runner/verdict.ts"
import { classOf, type ErrorCode } from "../src/support/codes.ts"
import type { TestError } from "../src/support/errors.ts"

const DANWO_FILE = fileURLToPath(new URL("../src/browser/session.ts", import.meta.url))

function error(code: ErrorCode, message: string, more: Partial<TestError> = {}): TestError {
  return { code, class: classOf(code), name: "Error", message, ...more }
}

function call(status: number, more: Partial<VerdictCall> = {}): VerdictCall {
  return {
    method: "POST",
    host: "127.0.0.1:3000",
    path: "/tasks?x=1",
    status,
    fault: null,
    disposition: "passthrough",
    ...more,
  }
}

function evidence(more: Partial<VerdictEvidence>): VerdictEvidence {
  return { error: undefined, calls: [], appLog: [], ...more }
}

describe("failure verdicts", () => {
  it("calls a failed check after the app answered a 5xx an app bug, for certain", () => {
    const found = failureVerdict(
      evidence({
        error: error("EXPECTATION_FAILED", "expected '0' to be '1'"),
        calls: [call(200), call(500)],
      }),
    )

    expect(found).toMatchObject({ verdict: "app", confidence: "certain" })
    expect(found.reason).toBe(
      "the app answered POST 127.0.0.1:3000/tasks with 500, then EXPECTATION_FAILED",
    )
  })

  it("does not blame the app for a 5xx a fault injected, or for an emulator's answer", () => {
    const found = failureVerdict(
      evidence({
        error: error("EXPECTATION_FAILED", "expected 1 to be 2"),
        calls: [call(500, { fault: "status 500" }), call(502, { disposition: "routed" })],
      }),
    )

    expect(found).toMatchObject({ verdict: "app", confidence: "likely" })
  })

  it("calls an uncaught page error, or an app that stopped, the app's", () => {
    const thrown = failureVerdict(
      evidence({
        error: error("LOCATOR_NOT_FOUND", "no element"),
        appLog: [{ level: "error", source: "page-error", text: "Cannot read 'map' of undefined" }],
      }),
    )
    const down = failureVerdict(
      evidence({ error: error("EXPECTATION_FAILED", "expected"), appsDown: ["api"] }),
    )

    expect(thrown.verdict).toBe("app")
    expect(thrown.reason).toContain("the page threw an uncaught error")
    expect(down.reason).toBe("the app api stopped during the test, then EXPECTATION_FAILED")
  })

  it("calls a locator that found nothing on a healthy page a likely test issue", () => {
    expect(
      failureVerdict(evidence({ error: error("LOCATOR_NOT_FOUND", "matched no element") })),
    ).toMatchObject({ verdict: "test", confidence: "likely" })
  })

  it("calls a failed check on a healthy app a likely app bug", () => {
    expect(
      failureVerdict(evidence({ error: error("EXPECTATION_FAILED", "expected 500, got 1000") })),
    ).toMatchObject({ verdict: "app", confidence: "likely" })
  })

  it("calls the test's own crash a test issue, naming its line", () => {
    const found = failureVerdict(
      evidence({
        error: error("TEST_FAILED", "Cannot read properties of undefined (reading 'request')", {
          name: "TypeError",
          stack:
            "TypeError: Cannot read properties of undefined\n    at /app/tests/billing.danwo.ts?danwo-realm=1:21:9",
          source: { file: "tests/billing.danwo.ts", line: 21 },
        }),
      }),
    )

    expect(found).toMatchObject({ verdict: "test", confidence: "certain" })
    expect(found.reason).toContain("at tests/billing.danwo.ts:21")
  })

  it("calls a crash thrown inside danwo a danwo bug", () => {
    const found = failureVerdict(
      evidence({
        error: error("TEST_FAILED", "x is undefined", {
          name: "TypeError",
          stack: `TypeError: x is undefined\n    at record (${DANWO_FILE}:10:3)\n    at /app/tests/a.danwo.ts?danwo-realm=1:5:1`,
        }),
      }),
    )

    expect(found.verdict).toBe("danwo")
    expect(found.reason).toContain("runner/src/browser/session.ts")
  })

  it("settles environment, config and undecided failures by their code", () => {
    expect(
      failureVerdict(evidence({ error: error("MODEL_UNAVAILABLE", "restricted access") })).verdict,
    ).toBe("environment")
    expect(failureVerdict(evidence({ error: error("CONFIG_INVALID", "bad config") })).verdict).toBe(
      "test",
    )
    expect(
      failureVerdict(evidence({ error: error("CLAIM_INCONCLUSIVE", "could not tell") })).verdict,
    ).toBe("undecided")
    expect(failureVerdict(evidence({ error: error("APP_ERROR", "500 from /buy") }))).toMatchObject({
      verdict: "app",
      confidence: "certain",
    })
  })

  it("calls a matrix trial's broken check the app's, under its fault", () => {
    const found = failureVerdict(
      evidence({
        error: error("EXPECTATION_FAILED", "invariant: expected 1000 to be 500"),
        fault: "duplicate on webhook checkout.session.completed",
      }),
    )

    expect(found).toEqual({
      verdict: "app",
      confidence: "certain",
      reason: "the check broke under the fault duplicate on webhook checkout.session.completed",
    })
  })

  it("weighs a saved session's failed setup like the step that failed it", () => {
    const failing = error("SESSION_SETUP_FAILED", 'session "bob" could not be set up')

    expect(failureVerdict(evidence({ error: failing })).verdict).toBe("test")
    expect(failureVerdict(evidence({ error: failing, calls: [call(503)] })).verdict).toBe("app")
  })

  it("reads stack frames, leaving out Node's own", () => {
    expect(
      stackFiles(
        "Error: x\n    at f (/a/b.ts:1:2)\n    at node:internal/x:3:4\n    at file:///c/d.ts:5:6",
      ),
    ).toEqual(["/a/b.ts", "/c/d.ts"])
  })

  it("counts verdicts for a summary line and says what to fix", () => {
    const app = failureVerdict(evidence({ error: error("APP_ERROR", "500") }))
    const test = failureVerdict(evidence({ error: error("CONFIG_INVALID", "x") }))

    expect(verdictSummary([app, app, test, undefined])).toBe("2 app bugs · 1 test issue")
    expect(fixAdvice(app)).toMatch(/^Fix the app/)
    expect(fixAdvice(test)).toMatch(/^Fix the test/)
  })
})
