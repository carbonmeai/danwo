import { execFile } from "node:child_process"
import { fileURLToPath } from "node:url"

import { afterAll, describe, expect, it } from "vitest"

import { removeWorkCopies, workCopy } from "./work-copy.ts"

const BIN = fileURLToPath(new URL("../bin/danwo.mjs", import.meta.url))
const INBOX = workCopy(fileURLToPath(new URL("./fixtures/agent-inbox/", import.meta.url)))

/** Runs `danwo <args>` in the inbox fixture, with `bug` switched on (or none). */
function danwo(args: readonly string[], bug?: string) {
  return new Promise<{ code: number; out: string }>((resolve) => {
    execFile(
      process.execPath,
      [BIN, ...args],
      {
        cwd: INBOX,
        env: { ...process.env, NO_COLOR: "1", ...(bug !== undefined && { INBOX_BUG: bug }) },
      },
      (error, stdout, stderr) => {
        const code = error === null ? 0 : typeof error.code === "number" ? error.code : 1

        resolve({ code, out: `${stdout}${stderr}` })
      },
    )
  })
}

const SEND = ["matrix", "tests/inbox.danwo.ts", "--grep", "sends the summary", "--workers", "4"]

afterAll(removeWorkCopies)

describe("an assistant app on the Composio emulator, backed by the Google emulator", () => {
  it("connects Gmail on Google's chooser, sends mail with a tool and takes signed triggers", async () => {
    const { code, out } = await danwo(["test"])

    expect(out).toContain("2 passed")
    expect(code).toBe(0)
  }, 180_000)

  it("survives every Composio fault on the send, and never mails the team twice", async () => {
    const { code, out } = await danwo(SEND)

    expect(out).toContain(
      "PASS  status 429 on POST backend.composio.dev/api/v3.1/tools/execute/GMAIL_SEND_EMAIL",
    )
    expect(out).toContain(
      "PASS  status 200 on POST backend.composio.dev/api/v3.1/tools/execute/GMAIL_SEND_EMAIL",
    )
    expect(out).toContain("PASS  double-submit on POST /send")
    // The hosted link and the OAuth callback are the browser's pages, never faulted.
    expect(out).not.toContain("connect.composio.dev/link")
    expect(out).not.toMatch(/FAIL /)
    expect(code).toBe(0)
  }, 300_000)

  it("catches an app that sends again when the form is submitted twice", async () => {
    const { code, out } = await danwo(SEND, "resend")

    expect(out).toContain("FAIL  double-submit on POST /send")
    expect(out).toContain("invariant: expected 2 to be less than or equal to 1")
    expect(code).toBe(1)
  }, 300_000)
})
