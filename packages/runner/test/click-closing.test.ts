import { describe, expect, it } from "vitest"

import { clickClosing } from "../src/browser/closed.ts"

const CLOSED = new Error("locator.click: Target page, context or browser has been closed")

/** A page that is closed already, closes shortly after the click, or stays open. */
function page(state: "closed" | "closing" | "open") {
  return {
    isClosed: () => state === "closed",
    waitForEvent: (_event: "close", { timeout }: { timeout: number }) =>
      state === "closing"
        ? new Promise((resolve) => setTimeout(resolve, 20))
        : new Promise((_resolve, reject) =>
            setTimeout(() => reject(new Error("timeout")), timeout),
          ),
  }
}

describe("a click that closes its own page", () => {
  it("counts as done when the page has closed, or closes just after", async () => {
    await expect(
      clickClosing(page("closed"), () => Promise.reject(CLOSED)),
    ).resolves.toBeUndefined()
    await expect(
      clickClosing(page("closing"), () => Promise.reject(CLOSED)),
    ).resolves.toBeUndefined()
  })

  it("still fails when the page stays open, or the click failed for another reason", async () => {
    await expect(clickClosing(page("open"), () => Promise.reject(CLOSED))).rejects.toBe(CLOSED)

    const other = new Error("locator.click: Timeout 5000ms exceeded")

    await expect(clickClosing(page("closed"), () => Promise.reject(other))).rejects.toBe(other)
  })

  it("leaves a click that worked alone", async () => {
    let clicked = false

    await clickClosing(page("open"), async () => {
      clicked = true
    })

    expect(clicked).toBe(true)
  })
})
