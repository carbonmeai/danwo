import { execFile } from "node:child_process"
import { rm } from "node:fs/promises"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

import { afterAll, describe, expect, it } from "vitest"

const BIN = fileURLToPath(new URL("../bin/danwo.mjs", import.meta.url))
const BOT = fileURLToPath(new URL("./fixtures/support-bot/", import.meta.url))

/** Runs the support bot's matrix with `bug` switched on (or none); its exit code and output. */
function matrix(bug?: string) {
  return new Promise<{ code: number; out: string }>((resolve) => {
    execFile(
      process.execPath,
      [BIN, "matrix", "tests/refund.danwo.ts", "--workers", "4"],
      {
        cwd: BOT,
        env: { ...process.env, NO_COLOR: "1", ...(bug !== undefined && { SUPPORT_BUG: bug }) },
      },
      (error, stdout, stderr) => {
        const code = error === null ? 0 : typeof error.code === "number" ? error.code : 1

        resolve({ code, out: `${stdout}${stderr}` })
      },
    )
  })
}

/** The faults that failed, without their ` #n` occurrence. */
function failed(out: string): string[] {
  const labels = out
    .split("\n")
    .flatMap((line) => /^FAIL {2}(\S+(?: \d+(?:ms)?)?) on /.exec(line)?.[1] ?? [])

  return [...new Set(labels)].toSorted()
}

afterAll(() => rm(join(BOT, ".danwo"), { recursive: true, force: true }))

describe("danwo matrix on an assistant that calls a model", () => {
  it("passes every model fault when the app retries once, refunds once and hides raw errors", async () => {
    const { code, out } = await matrix()

    expect(out).toContain("PASS  status 429 on POST api.openai.com/v1/chat/completions")
    expect(out).toContain("PASS  malformed-tool-call on POST api.openai.com/v1/chat/completions")
    expect(out).toContain("PASS  stream-cut on POST api.openai.com/v1/chat/completions #2")
    expect(out).toContain("faults: 26 passed")
    expect(code).toBe(0)
  }, 300_000)

  it("catches an app that shows the API's own error text to the customer", async () => {
    const { code, out } = await matrix("raw-errors")

    expect(failed(out)).toEqual([
      "malformed-tool-call",
      "reset",
      "reset-after",
      "status 400",
      "status 429",
      "status 500",
      "status 503",
      "stream-cut",
    ])
    expect(out).toContain("invariant: expected '429 Rate limit reached for requests' not to match")
    expect(code).toBe(1)
  }, 300_000)

  it("catches an app that refunds again when the reply after the refund fails", async () => {
    const { code, out } = await matrix("double-refund")

    expect(out).toContain("FAIL  status 429 on POST api.openai.com/v1/chat/completions #2")
    expect(out).toContain("PASS  status 429 on POST api.openai.com/v1/chat/completions\n")
    expect(out).toContain("invariant: expected 2 to be less than or equal to 1")
    expect(out).toContain("faults: 18 passed, 8 failed")
    expect(code).toBe(1)
  }, 300_000)
})
