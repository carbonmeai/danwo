/**
 * The page view the agent reads and the targets a recording keeps. The view relies on Playwright's
 * "ai" accessibility snapshot and its refs, so this pins the Playwright version and the format.
 */
import { createRequire } from "node:module"

import { type Browser, chromium, type Page } from "playwright-core"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { routeOf } from "../src/replay/route.ts"
import { describeTarget, findTarget } from "../src/replay/target.ts"
import { refLine, viewPage } from "../src/snapshot/view.ts"

const PAGE = `<!doctype html><title>Shop</title>
<h1>Shop</h1>
<label>Email <input name="email"></label>
<button type="button">Buy</button><button type="button">Buy</button>
<button type="button" data-testid="pay">Pay $5.00</button>
<p>Total: <b>$5.00</b></p>`

let browser: Browser
let page: Page

beforeAll(async () => {
  browser = await chromium.launch()
  page = await browser.newPage()
})

afterAll(async () => {
  await browser.close()
})

describe("page view", () => {
  it("runs on the pinned Playwright", () => {
    const version: unknown = createRequire(import.meta.url)("playwright-core/package.json").version

    expect(version).toBe("1.64.1")
  })

  it("shows roles, names and refs, and redacts what it shows", async () => {
    await page.setContent(PAGE)

    const view = await viewPage(page, (text) => text.replaceAll("Shop", "[secret s]"))

    expect(view.title).toBe("[secret s]")
    expect(view.tree).toMatch(/- heading "\[secret s\]" \[level=1\] \[ref=e\d+\]/)
    expect(view.tree).toMatch(/- textbox "Email" \[ref=e\d+\]/)
    expect(view.tree).toMatch(/- button "Pay \$5\.00" \[ref=e\d+\]/)
  })

  it("reads a ref's line back as role and name", async () => {
    await page.setContent(PAGE)

    const { tree } = await viewPage(page, (text) => text)
    const ref = /- button "Pay \$5\.00" \[ref=(e\d+)\]/.exec(tree)?.[1] ?? ""

    expect(refLine(tree, ref)).toEqual({ role: "button", name: "Pay $5.00" })
  })
})

/** The recorded target of the element `pattern` finds in the page view. */
async function targetOf(pattern: RegExp) {
  await page.setContent(PAGE)

  const { tree } = await viewPage(page, (text) => text)
  const ref = pattern.exec(tree)?.[1] ?? ""

  return describeTarget(page, tree, ref)
}

describe("recorded targets", () => {
  it("prefers a test id, then role and name, and counts equal matches", async () => {
    expect(await targetOf(/- button "Pay \$5\.00" \[ref=(e\d+)\]/)).toEqual({
      testId: "pay",
      role: "button",
      name: "Pay $5.00",
    })
    expect(await targetOf(/- textbox "Email" \[ref=(e\d+)\]/)).toEqual({
      role: "textbox",
      name: "Email",
    })

    const { tree } = await viewPage(page, (text) => text)
    const second = [...tree.matchAll(/- button "Buy" \[ref=(e\d+)\]/g)][1]?.[1] ?? ""

    expect(await describeTarget(page, tree, second)).toEqual({
      role: "button",
      name: "Buy",
      nth: 1,
    })
  })

  it("finds a target again on a fresh page, and refuses one that is gone", async () => {
    await page.setContent(PAGE)
    expect(await (await findTarget(page, { testId: "pay" }, 1_000)).textContent()).toBe("Pay $5.00")

    await page.setContent(PAGE.replace("Pay $5.00", "Checkout"))
    await expect(findTarget(page, { role: "button", name: "Pay $5.00" }, 300)).rejects.toThrow(
      /no longer on the page/,
    )
  })
})

describe("routes", () => {
  it("names the app's origin and turns generated path segments into :id", () => {
    expect(routeOf("http://127.0.0.1:5123/orders/42", "http://127.0.0.1:5123")).toBe(
      "app/orders/:id",
    )
    expect(
      routeOf("https://checkout.stripe.com/checkout/cs_test_a1B2c3D4e5", "http://127.0.0.1:5123"),
    ).toBe("checkout.stripe.com/checkout/:id")
    expect(routeOf("http://127.0.0.1:5123/thanks", "http://127.0.0.1:5123")).toBe("app/thanks")
  })
})
