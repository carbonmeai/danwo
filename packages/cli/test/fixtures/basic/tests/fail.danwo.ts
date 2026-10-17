import { test } from "@danwo/sdk"

test("fails its assertion", async ({ app, screen, expect }) => {
  await app.open("/")
  await expect(screen.getByRole("heading", { name: "Somewhere else" })).toBeVisible({
    timeout: 1_000,
  })
})
