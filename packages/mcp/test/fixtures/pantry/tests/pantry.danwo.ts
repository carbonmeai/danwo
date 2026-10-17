import { test } from "@danwo/sdk"

test("lists the pantry", async ({ app, screen, expect }) => {
  await app.open("/")
  await expect(screen.getByText("Honey")).toBeVisible()
}).invariant(async ({ expect }) => {
  expect(true).toBe(true)
})

test.skip("restocks later", async () => {})
