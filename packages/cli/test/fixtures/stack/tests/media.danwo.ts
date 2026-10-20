import { test } from "@danwo/sdk"

test("shows an outside image while its data stays blocked", async ({ app, screen, expect }) => {
  await app.open("/media")
  await expect(screen.getByText("image: settled")).toBeVisible()
  await expect(screen.getByText(/fetch: settled/)).toBeVisible()
})
