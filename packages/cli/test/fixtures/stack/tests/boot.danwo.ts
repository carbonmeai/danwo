import { test } from "@danwo/sdk"

test("opens the tasks page with its stream and socket live", async ({ app, screen, expect }) => {
  await app.open("/")
  await expect(screen.getByText("event: hello")).toBeVisible()
  await expect(screen.getByText("live: pong")).toBeVisible()
})
