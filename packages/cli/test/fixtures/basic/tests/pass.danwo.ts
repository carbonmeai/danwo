import { describe, test as base } from "@danwo/sdk"

const test = base.extend<{ hits: () => number }>()

describe("page", () => {
  test("shows the heading", async ({ app, screen, expect }) => {
    await app.open("/")
    await expect(screen.getByRole("heading", { name: /^Worker \d$/ })).toBeVisible()
  })

  test("sees the worker's fixture", async ({ app, expect, hits }) => {
    const before = hits()

    await app.open("/")
    expect(hits()).toBe(before + 1)
  })
})
