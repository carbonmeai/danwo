import { describe, expect, it } from "vitest"

import { recordingExpect } from "../src/assert/checks.ts"
import { expect as danwoExpect } from "../src/assert/index.ts"
import { StepRecorder } from "../src/record/index.ts"

/** A recorder that redacts one secret value, as a session's vault would. */
function recorder(): StepRecorder {
  return new StepRecorder({
    projectRoot: process.cwd(),
    redact: (text) => text.replaceAll("s3cret", "[secret]"),
  })
}

describe("checks of plain values", () => {
  it("records a passing check with what it got and wanted, in the phase it ran in", () => {
    const steps = recorder()
    const checking = recordingExpect(danwoExpect, steps)

    steps.enter("checks")
    checking(1, "messages in Bob's Inbox").toBe(1)

    const [step] = steps.all()

    expect(step).toMatchObject({
      kind: "check",
      api: "expect.toBe",
      label: `expect(messages in Bob's Inbox).toBe(1)`,
      status: "passed",
      phase: "checks",
      check: { actual: "1", expected: "1" },
    })
  })

  it("records a failed check with the matcher's own sides, and rethrows it", () => {
    const steps = recorder()
    const checking = recordingExpect(danwoExpect, steps)

    expect(() => checking([1, 2], "rows").toEqual([1])).toThrow(/rows/)

    const [step] = steps.all()

    expect(step?.status).toBe("failed")
    expect(step?.check).toEqual({ actual: "[1,2]", expected: "[1]" })
    expect(step?.error?.message).toMatch(/rows/)
  })

  it("keeps a chain in the label and records `resolves` once the promise settles", async () => {
    const steps = recorder()
    const checking = recordingExpect(danwoExpect, steps)

    checking("paid").not.toBe("pending")
    await checking(Promise.resolve(3)).resolves.toBe(3)

    expect(steps.all().map((step) => [step.label, step.status])).toEqual([
      [`expect("paid").not.toBe("pending")`, "passed"],
      ["expect(promise).resolves.toBe(3)", "passed"],
    ])
  })

  it("redacts secrets in labels and sides", () => {
    const steps = recorder()

    recordingExpect(danwoExpect, steps)("token s3cret").toContain("s3cret")

    const [step] = steps.all()

    expect(JSON.stringify(step)).not.toContain("s3cret")
  })
})

describe("the settle step", () => {
  it("records the wait with what it waited on, stamped settle", async () => {
    const steps = recorder()

    steps.enter("settle")
    await steps.settle(async () => ["inngest · 1.2 s · notify completed in 0.3 s"])

    const [step] = steps.all()

    expect(step).toMatchObject({
      kind: "settle",
      phase: "settle",
      status: "passed",
      waitedOn: ["inngest · 1.2 s · notify completed in 0.3 s"],
    })
  })

  it("fails the step when the wait gives up", async () => {
    const steps = recorder()

    await expect(
      steps.settle(() => Promise.reject(new Error("runs were still going"))),
    ).rejects.toThrow(/still going/)
    expect(steps.all()[0]?.status).toBe("failed")
  })
})
