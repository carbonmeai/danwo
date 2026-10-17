import { test } from "@danwo/sdk"

test("badge looks right", async ({ app, screen, expect }) => {
  await app.open("/")
  await expect(screen.getByTestId("badge")).toHaveScreenshot("badge")
})
