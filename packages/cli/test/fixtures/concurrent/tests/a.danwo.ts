import { test } from "@danwo/sdk"

import { meet } from "../meet.ts"

test("browser a meets the other browser", async ({ app, screen, expect }) => {
  await app.open("/")
  await expect(screen.getByRole("heading", { name: /^Worker \d$/ })).toBeVisible()
  await meet("a")
})
