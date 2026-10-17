/**
 * Error codes and classes: every failure gets one of danwo's codes, the code's class decides what
 * a run exits with, and the step that threw ends blocked, inconclusive or failed by that class.
 */
import { describe, expect, it } from "vitest"

import { NothingRecorded, StaleRecording } from "../src/agent/errors.ts"
import { StepRecorder } from "../src/record/steps.ts"
import {
  classOf,
  codeOf,
  DanwoError,
  exitCodeForError,
  exitCodeOf,
  notJudged,
} from "../src/support/codes.ts"
import { DeadlineExceeded } from "../src/support/deadline.ts"
import { toTestError } from "../src/support/errors.ts"

/** An error with the given name, as other libraries raise them. */
function named(name: string, message = "boom"): Error {
  const error = new Error(message)

  error.name = name

  return error
}

describe("codes", () => {
  it("keeps danwo's own codes and recognises other libraries' errors", () => {
    expect(codeOf(new NothingRecorded(0, "pay"))).toBe("NOTHING_RECORDED")
    expect(codeOf(new StaleRecording(1, "pay", ["instruction"]))).toBe("STALE_RECORDING")
    expect(codeOf(new DeadlineExceeded(5, "test"))).toBe("TIMED_OUT")
    expect(codeOf(named("AssertionError"))).toBe("EXPECTATION_FAILED")
    expect(codeOf(named("AI_APICallError"))).toBe("MODEL_UNAVAILABLE")
    expect(codeOf(named("GatewayTimeoutError"))).toBe("MODEL_UNAVAILABLE")
    expect(codeOf(named("GatewayAuthenticationError"))).toBe("CONFIG_INVALID")
    expect(codeOf(new Error("Target page, context or browser has been closed"))).toBe(
      "BROWSER_FAILED",
    )
    expect(codeOf(new TypeError("x is undefined"))).toBe("TEST_FAILED")
    expect(codeOf("thrown text")).toBe("TEST_FAILED")
  })

  it("classes codes and picks the run's exit code by precedence", () => {
    expect(classOf("CLAIM_BLOCKED")).toBe("blocked")
    expect(classOf("CLAIM_INCONCLUSIVE")).toBe("inconclusive")
    expect(classOf("MODEL_UNAVAILABLE")).toBe("infra")
    expect(exitCodeOf([])).toBe(0)
    expect(exitCodeOf(["test", "blocked"])).toBe(1)
    expect(exitCodeOf(["test", "infra"])).toBe(3)
    expect(exitCodeOf(["infra", "config"])).toBe(2)
    expect(exitCodeOf(["config", "interrupted"])).toBe(130)
    expect(exitCodeForError(new DanwoError("CONFIG_INVALID", "no cache"))).toBe(2)
    expect(notJudged("blocked") && notJudged("infra") && !notJudged("test")).toBe(true)
  })

  it("reports a failure with its code, class and own name", () => {
    expect(toTestError(new TypeError("nope"), "/")).toMatchObject({
      code: "TEST_FAILED",
      class: "test",
      name: "TypeError",
      message: "nope",
    })
  })

  it("ends a step blocked or inconclusive by its error's class", async () => {
    const steps = new StepRecorder({ projectRoot: "/", redact: (text) => text })
    const fail = (code: "CLAIM_BLOCKED" | "CLAIM_INCONCLUSIVE" | "CLAIM_FAILED") =>
      steps
        .run("agent", "agent.assert", code, () => Promise.reject(new DanwoError(code, code)))
        .catch(() => undefined)

    await fail("CLAIM_BLOCKED")
    await fail("CLAIM_INCONCLUSIVE")
    await fail("CLAIM_FAILED")

    expect(steps.all().map((step) => [step.status, step.error?.code])).toEqual([
      ["blocked", "CLAIM_BLOCKED"],
      ["inconclusive", "CLAIM_INCONCLUSIVE"],
      ["failed", "CLAIM_FAILED"],
    ])
  })
})
