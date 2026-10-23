import { test } from "@danwo/sdk"

import { openPage } from "./dashboard.ts"

test("opens on the overview, and lists the test runs and the matrix run", async (page) => {
  const { screen, expect } = page

  await openPage(page, "/")
  await expect(screen.getByRole("heading", { name: "Overview" })).toBeVisible({ timeout: 60_000 })
  await expect(screen.getByRole("region", { name: "Breaks under faults" })).toContainText(
    "duplicate on webhook checkout.session.completed",
  )
  await screen.getByRole("link", { name: "Runs", exact: true }).click()
  await expect(screen.getByText("danwo matrix", { exact: true })).toBeVisible()
  await expect(screen.getByText("danwo test", { exact: true }).first()).toBeVisible()
  await expect(screen.getByRole("link", { name: "3 tests" })).toBeVisible()
})

test("lists every test in the library with what the matrix made of it", async (page) => {
  const { screen, expect } = page

  await openPage(page, "/tests")

  const tests = screen.getByRole("table", { name: "Tests" })

  await expect(tests.getByRole("row").filter({ hasText: "buys 500 credits" })).toContainText(
    "breaks under: duplicate on webhook",
  )
  await expect(tests.getByRole("row").filter({ hasText: "shows a heading" })).toContainText(
    "failed",
  )
})

test("shows the impact index, the insights, the matrix and the settings", async (page) => {
  const { screen, expect } = page

  await openPage(page, "/impact")
  await expect(screen.getByText("api.stripe.com").first()).toBeVisible({ timeout: 30_000 })
  await openPage(page, "/insights?sort=faults")
  await expect(screen.getByRole("heading", { name: "Slowest tests" })).toBeVisible()
  await openPage(page, "/matrix")
  await expect(
    screen
      .getByRole("table", { name: "Tests under the matrix" })
      .getByRole("row")
      .filter({ hasText: "buys 500 credits" }),
  ).toContainText(/held|broke under/)
  await openPage(page, "/settings")
  await expect(screen.getByText("danwo.config.ts", { exact: true })).toBeVisible()
  await expect(screen.getByText(/the latest 50 keep theirs/)).toBeVisible()
})
