import { test } from "@danwo/sdk"

test("the examples gallery opens, and an example's details", async ({ app, screen, expect }) => {
  await app.open("/docs")
  await screen.getByRole("banner").getByRole("link", { name: "Examples" }).click()
  await expect(screen.getByRole("heading", { level: 1, name: "Example projects" })).toBeVisible()
  await expect(screen.getByRole("heading", { level: 3, name: "Commerce" })).toBeVisible()
  await screen.getByRole("link", { name: "Details" }).first().click()
  await expect(screen.getByRole("heading", { level: 1, name: "AI chat with tools" })).toBeVisible()
})
