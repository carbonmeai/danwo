/**
 * Styled radios and checkboxes, as component libraries draw them: the real input is invisible
 * behind a span inside its own label, so a click on the input lands on the span. Checking one goes
 * through its label, for a test's locator and for the agent alike; `force` skips Playwright's
 * actionability checks when a test asks for it.
 */
import { chromium } from "playwright-core"
import { afterAll, beforeAll, beforeEach, describe, expect, it, onTestFinished } from "vitest"

import { operate } from "../src/agent/operate.ts"
import { openWebSession, type WebSession } from "../src/index.ts"
import { serveHtml, type HtmlServer } from "./fixtures/html-server.ts"

/** Radios and a checkbox with the markup and styles of Element Plus. */
const PAGE = `<!doctype html><meta charset="utf-8"><title>Install</title>
<style>
  .el-radio, .el-checkbox { display: inline-flex; align-items: center; cursor: pointer; margin: 8px }
  .el-radio__input, .el-checkbox__input { position: relative; display: inline-flex }
  .el-radio__original, .el-checkbox__original {
    opacity: 0; outline: none; position: absolute; z-index: -1;
    top: 0; left: 0; right: 0; bottom: 0; margin: 0;
  }
  .el-radio__inner, .el-checkbox__inner {
    display: inline-block; width: 14px; height: 14px; border: 1px solid #888; border-radius: 50%;
  }
  .el-radio__original:checked + .el-radio__inner { background: #409eff }
  @keyframes pulse { from { transform: scale(1) } to { transform: scale(1.05) } }
  .pulse { animation: pulse 0.4s ease-in-out infinite alternate }
</style>
<h1>Install</h1>
<div role="radiogroup" aria-label="Mode">
  <label class="el-radio"><span class="el-radio__input"><input class="el-radio__original" type="radio" name="mode" value="install"><span class="el-radio__inner"></span></span><span class="el-radio__label">安装</span></label>
  <label class="el-radio"><span class="el-radio__input"><input class="el-radio__original" type="radio" name="mode" value="upgrade"><span class="el-radio__inner"></span></span><span class="el-radio__label">Upgrade</span></label>
</div>
<label class="el-checkbox"><span class="el-checkbox__input"><input class="el-checkbox__original" type="checkbox"><span class="el-checkbox__inner"></span></span><span>Keep settings</span></label>
<label><input type="checkbox" id="plain"> Plain</label>
<p><button type="button" class="pulse" id="pulse">Start now</button></p>
<p data-testid="clicked"></p>
<script>
  document.getElementById("pulse").addEventListener("click", () => {
    document.querySelector("[data-testid=clicked]").textContent = "clicked"
  })
</script>`

let server: HtmlServer
let session: WebSession

beforeAll(async () => {
  server = await serveHtml(() => PAGE)
  session = await openWebSession({ baseUrl: server.url, actionTimeout: 1_000 })
}, 60_000)

afterAll(async () => {
  await session.close()
  await server.close()
})

beforeEach(async () => {
  await session.app.open("/")
})

describe("a styled radio or checkbox", () => {
  it("is checked through its label, and only the chosen radio is", async () => {
    const { screen } = session
    const install = screen.getByRole("radio", { name: "安装" })

    await install.check()

    expect(await install.isChecked()).toBe(true)
    expect(await screen.getByRole("radio", { name: "Upgrade" }).isChecked()).toBe(false)

    await screen.getByRole("radio", { name: "Upgrade" }).check()

    expect(await install.isChecked()).toBe(false)
  })

  it("is checked and unchecked, and checking a checked box leaves it checked", async () => {
    const keep = session.screen.getByRole("checkbox", { name: "Keep settings" })

    await keep.check()
    await keep.check()
    expect(await keep.isChecked()).toBe(true)

    await keep.uncheck()
    expect(await keep.isChecked()).toBe(false)
  })

  it("leaves a plain checkbox to Playwright", async () => {
    const plain = session.screen.getByRole("checkbox", { name: "Plain" })

    await plain.check()
    expect(await plain.isChecked()).toBe(true)
  })

  it("is checked when the agent checks it", async () => {
    const browser = await chromium.launch()
    const page = await browser.newPage()

    onTestFinished(() => browser.close())
    await page.goto(server.url)

    await operate(
      page.getByRole("radio", { name: "安装" }),
      { kind: "check", checked: true },
      1_000,
    )
    await operate(
      page.getByRole("checkbox", { name: "Keep settings" }),
      { kind: "check", checked: true },
      1_000,
    )

    expect(await page.getByRole("radio", { name: "安装" }).isChecked()).toBe(true)
    expect(await page.getByRole("checkbox", { name: "Keep settings" }).isChecked()).toBe(true)
  })

  it("fails as unchecked when a radio is asked to uncheck", async () => {
    const install = session.screen.getByRole("radio", { name: "安装" })

    await install.check()

    await expect(install.uncheck()).rejects.toThrow(/cannot be unchecked/)
  })
})

describe("force", () => {
  it("clicks a button that never stops moving, which a plain click waits on", async () => {
    const start = session.screen.getByRole("button", { name: "Start now" })

    await expect(start.click({ timeout: 500 })).rejects.toMatchObject({
      code: "LOCATOR_NOT_READY",
    })

    await start.click({ force: true })

    expect(await session.screen.getByTestId("clicked").textContent()).toBe("clicked")
  })

  it("checks a styled checkbox through Playwright alone", async () => {
    const keep = session.screen.getByRole("checkbox", { name: "Keep settings" })

    await keep.check({ force: true })

    expect(await keep.isChecked()).toBe(true)
  })
})
