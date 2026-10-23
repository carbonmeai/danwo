import { test } from "@danwo/sdk"

test("the changelog lists 0.1.1 first, above 0.1.0", async ({ app, screen, expect }) => {
  await app.open("/")
  await screen
    .getByRole("navigation", { name: "Primary" })
    .getByRole("link", { name: "Docs" })
    .click()
  await screen.getByRole("banner").getByRole("link", { name: "Changelog" }).click()
  await expect(screen.getByRole("heading", { level: 1, name: "Changelog" })).toBeVisible()

  const releases = screen.getByRole("heading", { level: 2, name: /^danwo \d/ })

  await expect(releases.first()).toHaveText("danwo 0.1.1")
  await expect(releases.nth(1)).toHaveText("danwo 0.1.0")
})
