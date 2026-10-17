import { test } from "@danwo/sdk"

test("shows the credits offer", async ({ app, screen, expect }) => {
  await app.open("/")
  await expect(screen.getByRole("button", { name: "Buy 500 credits" })).toBeVisible()
})
