/*
 * Contract: `expect` on a locator waits for the page to get there, and a failure names the
 * matcher, the locator, what was expected and what was on screen. Public API only.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"

import { openWebSession, type WebSession } from "../../src/index.ts"
import { type Site, startSite } from "./site.ts"

let site: Site
let session: WebSession

beforeAll(async () => {
  site = await startSite()
  session = await openWebSession({ baseUrl: site.url, assertionTimeout: 3_000 })
}, 60_000)

afterAll(async () => {
  await session.close()
  await site.close()
})

beforeEach(async () => {
  await session.app.open("/form")
})

/** The statuses of the session's last `count` recorded steps. */
function lastSteps(count: number): string[] {
  return session.flight
    .steps()
    .slice(-count)
    .map((step) => step.status)
}

describe("matchers that pass", () => {
  it("checks visibility, state, text, value, count and attributes", async () => {
    const { screen } = session
    const check = session.expect

    await check(screen.getByRole("heading", { name: "Sign up" })).toBeVisible()
    await check(screen.getByText("Hidden note")).toBeHidden()
    await check(screen.getByRole("button", { name: "Save" })).toBeEnabled()
    await check(screen.getByRole("button", { name: "Delete" })).toBeDisabled()
    await check(screen.getByTestId("status")).toHaveText("Not saved")
    await check(screen.getByTestId("status")).toHaveText(/not saved/i)
    await check(screen.getByTestId("status")).toContainText("saved")
    await check(screen.getByDisplayValue("already here")).toHaveValue("already here")
    await check(screen.getByRole("listitem")).toHaveCount(3)
    await check(screen.getByTestId("status")).toHaveAttribute("title", "status line")

    await screen.getByLabel("Accept terms").check()
    await check(screen.getByLabel("Accept terms")).toBeChecked()
    expect(lastSteps(12)).toEqual(Array.from({ length: 12 }, () => "passed"))
  })

  it("negates with not", async () => {
    const { screen } = session
    const check = session.expect

    await check(screen.getByText("Nowhere on the page")).not.toBeVisible()
    await check(screen.getByTestId("status")).not.toHaveText("Saved")
    await check(screen.getByLabel("Accept terms")).not.toBeChecked()
    expect(lastSteps(3)).toEqual(["passed", "passed", "passed"])
  })

  it("waits for the page to catch up", async () => {
    // "Arrived late" is added 700 ms after the page loads.
    await session.expect(session.screen.getByText("Arrived late")).toBeVisible()
    expect(await session.screen.getByText("Arrived late").isVisible()).toBe(true)
  })

  it("checks plain values too", () => {
    session.expect(1 + 1).toBe(2)
    session.expect({ credits: 500, user: "ada" }).toEqual({ credits: 500, user: "ada" })
    expect(() => session.expect(1 + 1).toBe(3)).toThrow(/expected 2 to be 3/)
  })
})

describe("matchers that fail", () => {
  it("names the matcher, the locator, the expected and the observed text", async () => {
    const failure = session
      .expect(session.screen.getByTestId("status"))
      .toHaveText("Saved", { timeout: 500 })

    await expect(failure).rejects.toThrow(/toHaveText/)
    await expect(failure).rejects.toThrow(/getByTestId\("status"\)/)
    await expect(failure).rejects.toThrow(/Saved/)
    await expect(failure).rejects.toThrow(/Not saved/)
  })

  it("fails a negated matcher that holds", async () => {
    await expect(
      session.expect(session.screen.getByText("Apple")).not.toBeVisible({ timeout: 500 }),
    ).rejects.toThrow(/not\.toBeVisible/)
  })

  it("gives up after its timeout", async () => {
    const started = Date.now()

    await expect(
      session.expect(session.screen.getByText("Never shown")).toBeVisible({ timeout: 500 }),
    ).rejects.toThrow(/toBeVisible/)
    expect(Date.now() - started).toBeLessThan(2_500)
  })

  it("fails on the wrong count", async () => {
    await expect(
      session.expect(session.screen.getByRole("listitem")).toHaveCount(2, { timeout: 500 }),
    ).rejects.toThrow(/toHaveCount/)
  })
})
