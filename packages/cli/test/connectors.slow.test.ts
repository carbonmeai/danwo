import { execFile } from "node:child_process"
import { fileURLToPath } from "node:url"

import { afterAll, describe, expect, it } from "vitest"

import { removeWorkCopies, workCopy } from "./work-copy.ts"

const BIN = fileURLToPath(new URL("../bin/danwo.mjs", import.meta.url))
const APP = workCopy(fileURLToPath(new URL("./fixtures/follow-up/", import.meta.url)))

/** Runs `danwo <args>` in the follow-up fixture, with `bug` switched on (or none). */
function danwo(args: readonly string[], bug?: string) {
  return new Promise<{ code: number; out: string }>((resolve) => {
    execFile(
      process.execPath,
      [BIN, ...args],
      {
        cwd: APP,
        env: { ...process.env, NO_COLOR: "1", ...(bug !== undefined && { FOLLOW_UP_BUG: bug }) },
      },
      (error, stdout, stderr) => {
        const code = error === null ? 0 : typeof error.code === "number" ? error.code : 1

        resolve({ code, out: `${stdout}${stderr}` })
      },
    )
  })
}

const FOLLOW_UP = [
  "matrix",
  "tests/follow-up.danwo.ts",
  "--grep",
  "sends the follow-up",
  "--workers",
  "4",
]

afterAll(removeWorkCopies)

describe("a sales app on the Nylas, Nango and Unipile emulators", () => {
  it("reads the inbox and follows up by email, in the CRM and on LinkedIn, unchanged", async () => {
    const { code, out } = await danwo(["test"])

    expect(out).toContain("2 passed")
    expect(code).toBe(0)
  }, 180_000)

  it("survives every fault on the three sends, and never follows up twice", async () => {
    const { code, out } = await danwo(FOLLOW_UP)

    expect(out).toContain("PASS  status 429 on POST api.us.nylas.com/v3/grants/:id/messages/send")
    expect(out).toContain("PASS  reset-after on POST api.nango.dev/proxy/crm/v3/objects/notes")
    expect(out).toContain("PASS  status 401 on POST api8.unipile.com/api/v1/chats")
    expect(out).toContain("PASS  double-submit on POST /follow-up")
    expect(out).not.toMatch(/(FAIL|INVALID) /)
    expect(code).toBe(0)
  }, 300_000)

  it("catches an app that follows up again when the form is submitted twice", async () => {
    const { code, out } = await danwo(FOLLOW_UP, "resend")

    expect(out).toContain("FAIL  double-submit on POST /follow-up")
    expect(code).not.toBe(0)
  }, 300_000)
})
