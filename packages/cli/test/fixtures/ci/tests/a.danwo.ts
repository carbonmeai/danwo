import { test } from "@danwo/sdk"

import { HEADING } from "../lib/heading.ts"

test("a sees the heading", async ({ app, screen, expect }) => {
  await app.open("/")
  await expect(screen.getByRole("heading", { name: HEADING })).toBeVisible()
})
