/**
 * Text that is cut to length is redacted first, so a secret straddling the cut leaves none of its
 * characters behind: the agent's page view, a failed locator's candidates, the marks a vision
 * look lists, and a check's previewed sides. A record gets a last pass over every string with the
 * secrets known when it is written, including one revealed after the text was recorded.
 */
import { type Browser, chromium, type Page } from "playwright-core"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { candidateLine } from "../src/locate/failure.ts"
import { preview } from "../src/record/steps.ts"
import { buildRecord, type RecordInput } from "../src/runner/record.ts"
import { SecretVault } from "../src/secrets/index.ts"
import { viewPage } from "../src/snapshot/view.ts"
import { marksText } from "../src/vision/screen.ts"

const SECRET = "tok_live_9f8e7d6c5b4a"
/** Enough of the secret's start to tell it apart from other text. */
const PREFIX = SECRET.slice(0, 5)

const vault = new SecretVault({ token: SECRET })

let browser: Browser

beforeAll(async () => {
  browser = await chromium.launch()
})

afterAll(async () => {
  await browser.close()
})

/** Paragraphs of filler enough to push the last one past the view's cut. */
const FILLER = Array.from({ length: 1_000 }, (_, n) => `<p>row ${n} ${"a".repeat(80)}</p>`).join("")

/**
 * A new page (so its refs number from the start) of the filler, then a paragraph of `pad`
 * characters of padding and the secret.
 */
async function paddedPage(pad: number): Promise<Page> {
  const page = await browser.newPage()

  await page.setContent(
    `<!doctype html><title>Keys</title>${FILLER}<p>${"z".repeat(pad)}${SECRET}</p>`,
  )

  return page
}

describe("the agent's page view", () => {
  it("leaves no part of a secret that straddles the cut at 120 000 characters", async () => {
    const probe = await viewPage(await paddedPage(0), (text) => text)
    const shift = 120_000 - probe.tree.indexOf(SECRET) - 6
    const raw = await viewPage(await paddedPage(shift), (text) => text)

    expect(raw.tree).toContain(`${"z".repeat(9)}${SECRET.slice(0, 6)}\n… (page cut`)

    const view = await viewPage(await paddedPage(shift), vault.redact)

    expect(view.tree).toContain("(page cut at 120000 characters)")
    expect(view.tree).not.toContain(PREFIX)
  })
})

describe("text cut for a record or the model", () => {
  const long = `${"b".repeat(195)}${SECRET}`

  it("cuts a failed locator's candidate only once it is redacted", () => {
    const line = candidateLine(long, vault.redact)

    expect(line).toHaveLength(200)
    expect(line).not.toContain(PREFIX)
  })

  it("cuts a vision mark's words only once they are redacted", () => {
    const marks = [{ id: 1, box: { x: 0, y: 0, width: 9, height: 9 }, hint: `div ${long}` }]

    expect(marksText(marks, vault.redact)).not.toContain(PREFIX)
  })

  it("cuts a check's preview only once it is redacted", () => {
    const shown = preview(`${"c".repeat(150)}${SECRET}`, vault.redact)

    expect(shown).not.toContain(PREFIX)
    expect(preview(`${"c".repeat(150)}${SECRET}`)).toContain(PREFIX)
  })
})

describe("a flight record", () => {
  it("is redacted once more with every secret known when it is written", async () => {
    const late = new SecretVault({ token: () => Promise.resolve(SECRET) })
    const input: RecordInput = {
      test: `tests/keys.danwo.ts › rotates ${SECRET}`,
      run: { kind: "test", attempt: 1 },
      status: "failed",
      error: {
        code: "EXPECTATION_FAILED",
        class: "test",
        name: "AssertionError",
        message: `saw ${SECRET}`,
      },
      stopped: undefined,
      divergence: undefined,
      notes: [],
      durationMs: 5,
      flight: {
        session: {
          steps: () => [],
          appLog: () => [],
          screenshots: () => new Map(),
          redact: late.redact,
          captureFailure: () => Promise.resolve(undefined),
          settle: () => Promise.resolve(),
        },
        failure: undefined,
        startedAt: "2026-10-21T00:00:00.000Z",
      },
      env: undefined,
      mark: { exchanges: 0, deliveries: 0 },
    }

    /* The secret is revealed only after the run wrote it down. */
    await late.reveal(late.handle("token"))

    const text = JSON.stringify(buildRecord(input))

    expect(text).not.toContain(SECRET)
    expect(text).toContain("rotates [secret token]")
  })
})
