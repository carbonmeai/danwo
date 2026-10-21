/**
 * A step's automatic screenshot must leave the page as it was: an app still hydrating reports a
 * changed attribute or inline style on one of its fields as a mismatch, which fails a test that
 * watches the console. Secrets are still masked, through locators rather than marks on the page.
 */
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { type Browser, chromium, type Page } from "playwright-core"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { registerValueEngine } from "../src/locate/index.ts"
import { takeScreenshot } from "../src/record/screenshots.ts"

const PAGE = `<!doctype html><title>Sign up</title>
<main id="root">
  <label>Email <input name="email" value="ada@shop.test"></label>
  <label>Token <input name="token" value="tok_live_abc123"></label>
  <label>Notes <textarea>Hello</textarea></label>
  <div contenteditable="true">Draft</div>
</main>`

declare global {
  interface Window {
    /** Every change made inside the app's root since the page loaded. */
    changes?: string[]
  }
}

/** Records every change inside `#root`, as a hydrating framework would see it. Runs in the page. */
function watchRoot(): void {
  const changes: string[] = []
  const root = document.getElementById("root")

  window.changes = changes

  if (root === null) return

  new MutationObserver((records) => {
    for (const record of records)
      changes.push(`${record.type} ${record.attributeName ?? ""} on ${record.target.nodeName}`)
  }).observe(root, { attributes: true, childList: true, subtree: true, characterData: true })
}

let browser: Browser
let page: Page
let dir: string

beforeAll(async () => {
  await registerValueEngine()
  browser = await chromium.launch()
  page = await browser.newPage()
  dir = await mkdtemp(join(tmpdir(), "danwo-shot-"))
})

afterAll(async () => {
  await browser.close()
  await rm(dir, { recursive: true, force: true })
})

describe("an automatic step screenshot", () => {
  it("changes nothing in the app's root, with or without secrets in play", async () => {
    await page.setContent(PAGE)
    await page.evaluate(watchRoot)

    const plain = await takeScreenshot({
      page,
      dir,
      path: "plain.png",
      secrets: [],
      timeout: 5_000,
    })
    const masked = await takeScreenshot({
      page,
      dir,
      path: "masked.png",
      secrets: ["tok_live_abc123"],
      timeout: 5_000,
    })

    expect(plain).toBe("plain.png")
    expect(masked).toBe("masked.png")
    expect(await page.evaluate(() => window.changes)).toEqual([])
    expect(
      await page.locator("input, textarea").evaluateAll((all) => all.map((e) => e.outerHTML)),
    ).toEqual([
      '<input name="email" value="ada@shop.test">',
      '<input name="token" value="tok_live_abc123">',
      "<textarea>Hello</textarea>",
    ])
  })

  it("is not taken when the page's text shows a secret", async () => {
    await page.setContent(`<p>Your key is tok_live_abc123</p>`)

    let told = false
    const shot = await takeScreenshot({
      page,
      dir,
      path: "shown.png",
      secrets: ["tok_live_abc123"],
      timeout: 5_000,
      onSecretShown: () => {
        told = true
      },
    })

    expect(shot).toBeUndefined()
    expect(told).toBe(true)
  })
})
