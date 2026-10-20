import { fileURLToPath } from "node:url"

import { describe, expect, it } from "vitest"

import { fixAdvice, verdictSummary } from "../src/runner/verdict-words.ts"
import {
  failureVerdict,
  serverErrorRoutes,
  stackFiles,
  type VerdictCall,
  type VerdictEvidence,
  type VerdictStep,
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

/** A time `s` seconds into the attempt. */
const at = (s: number) => new Date(Date.UTC(2026, 9, 20, 19) + s * 1000).toISOString()

/** A step `index` that ran from second `s` for one second. */
function step(index: number, s: number, more: Partial<VerdictStep> = {}): VerdictStep {
  return {
    index,
    kind: "locator",
    api: "locator.click",
    status: "passed",
    startedAt: at(s),
    durationMs: 1000,
    ...more,
  }
}

const changelogs = (s: number) =>
  call(502, { method: "GET", path: "/api/changelogs", startedAt: at(s), durationMs: 400 })
const createTask = (s: number) => call(500, { startedAt: at(s), durationMs: 200 })

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

  it("leaves a failed check after a step the model carried out undecided, naming the step", () => {
    const act = (mode: string) =>
      step(1, 1, { kind: "agent", api: "agent.act", label: "add Bob", cache: { mode } })
    const check = step(2, 3, { kind: "check", api: "expect.toBe", status: "failed" })
    const failed = error("EXPECTATION_FAILED", "Bob on the task: expected '0' to be '1'")

    expect(
      failureVerdict(evidence({ error: failed, steps: [act("handed-off"), check] })),
    ).toMatchObject({
      verdict: "undecided",
      confidence: "likely",
      reason: expect.stringContaining('"add Bob"'),
    })
    expect(
      failureVerdict(evidence({ error: failed, steps: [act("replayed"), check] })),
    ).toMatchObject({ verdict: "app", confidence: "likely" })
    expect(
      failureVerdict(
        evidence({ error: failed, steps: [act("missed"), check], calls: [createTask(2)] }),
      ),
    ).toMatchObject({ verdict: "app", confidence: "certain" })
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

  describe("which 5xx explains the failure", () => {
    /* Opens the board, checks it shows, creates a task, then fails a check of the result. */
    const steps = [
      step(0, 0),
      step(1, 2, { kind: "assertion", api: "expect.toBeVisible" }),
      step(2, 4),
      step(3, 6, { kind: "assertion", api: "expect.toBeVisible", status: "failed" }),
    ]
    const failed = error("EXPECTATION_FAILED", "expected the notification")

    it("names a write the failing work made over an earlier GET, for certain", () => {
      const found = failureVerdict(
        evidence({ error: failed, steps, calls: [changelogs(0), createTask(4)] }),
      )

      expect(found).toMatchObject({ verdict: "app", confidence: "certain" })
      expect(found.reason).toContain("POST 127.0.0.1:3000/tasks with 500")
    })

    it("names the 5xx closest before the failing step, and none after it", () => {
      const found = failureVerdict(
        evidence({
          error: failed,
          steps,
          calls: [
            createTask(0.5),
            call(503, { path: "/later", startedAt: at(4.5) }),
            createTask(9),
          ],
        }),
      )

      expect(found.reason).toContain("/later with 503")
    })

    it("is only likely for a GET, or for a write before the failing work", () => {
      const get = failureVerdict(evidence({ error: failed, steps, calls: [changelogs(4)] }))
      const earlier = failureVerdict(evidence({ error: failed, steps, calls: [createTask(0.5)] }))

      expect(get).toMatchObject({ verdict: "app", confidence: "likely" })
      expect(earlier).toMatchObject({ verdict: "app", confidence: "likely" })
    })

    it("leaves out a route that also failed in passing attempts", () => {
      const found = failureVerdict(
        evidence({
          error: failed,
          steps,
          calls: [changelogs(4)],
          baseline: new Set(["GET 127.0.0.1:3000/api/changelogs"]),
        }),
      )

      expect(found).toMatchObject({ verdict: "app", confidence: "likely" })
      expect(found.reason).toContain("the app answering without errors")
      expect(
        serverErrorRoutes([changelogs(0), call(500, { path: "/tasks/42" }), call(200)]),
      ).toEqual(["GET 127.0.0.1:3000/api/changelogs", "POST 127.0.0.1:3000/tasks/:id"])
    })

    it("leaves out a 5xx that only passed on a blocked host's refusal", () => {
      const blocked = call(502, {
        method: "GET",
        host: "cms.danwo.invalid",
        path: "/api/changelogs",
        disposition: "blocked",
        client: "server",
        startedAt: at(4.1),
      })
      const found = failureVerdict(
        evidence({ error: failed, steps, calls: [changelogs(4), blocked] }),
      )

      expect(found.reason).toContain("the app answering without errors")
    })

    it("calls a failed claim with no app error while it ran undecided", () => {
      const claim = error("CLAIM_FAILED", "the judge says Bob is not assigned")
      const judgedSteps = [
        step(0, 0, { kind: "agent", api: "agent.assert" }),
        step(1, 2, { kind: "agent", api: "agent.act" }),
        step(2, 4, { kind: "agent", api: "agent.assert", status: "failed" }),
      ]
      const clean = failureVerdict(evidence({ error: claim, steps: judgedSteps }))
      /* The only 5xx came before the claim that held, so it is not the failing work's. */
      const noise = failureVerdict(
        evidence({ error: claim, steps: judgedSteps, calls: [changelogs(0.5)] }),
      )
      const broke = failureVerdict(
        evidence({ error: claim, steps: judgedSteps, calls: [createTask(2.5)] }),
      )

      expect(clean).toEqual({
        verdict: "undecided",
        confidence: "likely",
        reason: "the judge says the claim doesn't hold",
      })
      expect(noise.verdict).toBe("undecided")
      expect(broke).toMatchObject({ verdict: "app", confidence: "certain" })
    })
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
