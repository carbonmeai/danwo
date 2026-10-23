/**
 * Runs started from the dashboard. They add runs to the project, so this file's name sorts after
 * the others': with one worker, files run in name order, and the others read the runs as made.
 */
import { test } from "@danwo/sdk"

import { openPage } from "./dashboard.ts"

test("reruns one test from its run and opens the new run", async (page) => {
  const { screen, expect } = page

  await openPage(page, "/runs")

  /* The failing test's own run is one test already. */
  const single = await screen.getByRole("link", { name: "1 test" }).count()

  await screen.getByRole("link", { name: "3 tests" }).click()
  await screen.getByRole("button", { name: /Rerun tests\/storefront\.danwo\.ts/ }).click()
  await expect(screen.getByRole("heading", { name: "1 test" })).toBeVisible({ timeout: 60_000 })
  await openPage(page, "/runs")
  await expect(screen.getByRole("link", { name: "1 test" })).toHaveCount(single + 1)
})

test(
  "runs a matrix from the dashboard and shows it live until it becomes the run's page",
  { timeout: 240_000 },
  async (page) => {
    const { screen, expect } = page

    await openPage(page, "/runs?kind=matrix")
    await screen.getByRole("link", { name: /buys 500 credits/ }).click()
    await screen.getByRole("button", { name: "Run the matrix" }).click()
    await screen.getByRole("textbox", { name: "Only faults containing" }).fill("on POST /buy")
    await screen.getByRole("button", { name: "Run", exact: true }).click()

    await expect(screen.getByText("running", { exact: true }).first()).toBeVisible({
      timeout: 60_000,
    })
    await expect(screen.getByRole("table", { name: "Fault grid" })).toBeVisible({
      timeout: 120_000,
    })
    await expect(screen.getByRole("button", { name: /double-submit on POST \/buy/ })).toBeVisible()
  },
)
