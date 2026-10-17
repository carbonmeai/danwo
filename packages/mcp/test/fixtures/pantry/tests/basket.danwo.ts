import { test } from "@danwo/sdk"

test("adds oats to the basket", async ({ app, screen, expect }) => {
  await app.open("/")
  await screen.getByRole("link", { name: "Add oats to basket" }).click()
  await expect(screen.getByRole("heading", { name: "Basket" })).toBeVisible()
})

test("checks out", async ({ app, screen, expect }) => {
  await app.open("/basket")
  await expect(screen.getByRole("heading", { name: "Order placed" })).toBeVisible({
    timeout: 1_000,
  })
})
