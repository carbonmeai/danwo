/**
 * Copied into the prepared project beside the shop's own tests: a test the shop cannot pass, so
 * its run keeps a failed attempt with steps, screenshots and a video for the dashboard to show.
 */
import { test } from "@danwo/sdk"

test("shows a heading the shop does not have", async ({ app, screen, expect }) => {
  await app.open("/")
  await expect(screen.getByRole("heading", { name: "Not on this page" })).toBeVisible({
    timeout: 1_000,
  })
})
