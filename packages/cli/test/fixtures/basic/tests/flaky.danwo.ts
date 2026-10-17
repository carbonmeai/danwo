import { existsSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { test as base } from "@danwo/sdk"

const test = base.extend<{ marker: string }>({
  marker: async (_fixtures, use) => {
    await use(join(process.env.DANWO_FIXTURE_STATE ?? ".", "flaky-ran"))
  },
})

test("passes on its retry", async ({ app, screen, expect, marker }) => {
  await app.open("/")

  const firstAttempt = !existsSync(marker)

  writeFileSync(marker, "")
  await expect(
    screen.getByRole("heading", { name: firstAttempt ? "Nope" : /^Worker/ }),
  ).toBeVisible({
    timeout: 1_000,
  })
})
