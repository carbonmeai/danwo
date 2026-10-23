import { test } from "@danwo/sdk"

import { openPage } from "./dashboard.ts"

test("shows the matrix as a grid of faults, the duplicate webhook failed", async (page) => {
  const { screen, expect } = page

  await openPage(page, "/runs?kind=matrix")
  await screen.getByRole("link", { name: /buys 500 credits/ }).click()
  await expect(
    screen.getByRole("button", {
      name: /duplicate on webhook checkout\.session\.completed: failed/,
    }),
  ).toBeVisible()
  await screen.getByRole("tab", { name: "List" }).click()
  await expect(screen.getByRole("list", { name: "Faults" })).toBeVisible()

  const duplicate = screen
    .getByRole("listitem")
    .filter({ hasText: "duplicate on webhook checkout.session.completed" })

  await expect(duplicate).toContainText("failed")
  await expect(duplicate).toContainText("expected 1000 to be 500")
})
