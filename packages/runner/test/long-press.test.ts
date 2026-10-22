/**
 * A long press from a test's locator on a web page: the mouse goes down on the element and stays
 * down for the asked time, so a page that tells a held press from a click sees a held one, and the
 * press is a step of its own.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"

import { openWebSession, type WebSession } from "../src/index.ts"
import { serveHtml, type HtmlServer } from "./fixtures/html-server.ts"

/** A button that says "held" after a press of 500 ms or more, and "clicked" after a shorter one. */
const PAGE = `<!doctype html><meta charset="utf-8"><title>Hold</title>
<button type="button" id="hold">Hold me</button>
<button type="button" id="off" disabled>Not now</button>
<p data-testid="said"></p>
<script>
  const said = document.querySelector("[data-testid=said]")
  let downAt = 0
  const hold = document.getElementById("hold")
  hold.addEventListener("mousedown", () => { downAt = performance.now() })
  hold.addEventListener("mouseup", () => {
    said.textContent = performance.now() - downAt >= 500 ? "held" : "clicked"
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

describe("a locator's long press on a web page", () => {
  it("holds the press for durationMs, where a click does not", async () => {
    const { screen } = session
    const button = screen.getByRole("button", { name: "Hold me" })
    const said = screen.getByTestId("said")

    await button.click()
    expect(await said.textContent()).toBe("clicked")

    await button.longPress({ durationMs: 600 })
    expect(await said.textContent()).toBe("held")
    expect(session.flight.steps().map((step) => step.label)).toContain(
      'getByRole("button", name: "Hold me").longPress(durationMs: 600)',
    )
  })

  it("holds 800 ms by default, and records the press as a step", async () => {
    const { screen } = session
    const started = Date.now()

    await screen.getByRole("button", { name: "Hold me" }).longPress()

    expect(Date.now() - started).toBeGreaterThanOrEqual(800)
    expect(await screen.getByTestId("said").textContent()).toBe("held")

    const labels = session.flight.steps().map((step) => [step.api, step.label])

    expect(labels).toContainEqual([
      "locator.longPress",
      'getByRole("button", name: "Hold me").longPress()',
    ])
  })

  it("waits for the element to be enabled, as a click does", async () => {
    const press = session.screen.getByRole("button", { name: "Not now" }).longPress({
      durationMs: 100,
      timeout: 300,
    })

    await expect(press).rejects.toMatchObject({
      message: expect.stringContaining("locator.longPress"),
    })
  })

  it("refuses a negative duration", async () => {
    const press = session.screen.getByRole("button", { name: "Hold me" }).longPress({
      durationMs: -1,
    })

    await expect(press).rejects.toThrow("longPress takes a durationMs of 0 or more")
  })
})
