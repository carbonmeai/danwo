import { readdirSync } from "node:fs"
import { fileURLToPath } from "node:url"

import { test } from "@danwo/sdk"

/** The releases the changelog has entries for, newest first, as "danwo 0.1.2". */
function releasesNewestFirst(): string[] {
  const dir = fileURLToPath(new URL("../../content/changelog", import.meta.url))

  return readdirSync(dir)
    .map((name) => /^(\d+)\.(\d+)\.(\d+)\.mdx$/.exec(name))
    .filter((match) => match !== null)
    .map((match) => match.slice(1, 4).map(Number))
    .toSorted(
      (a, b) => (b[0] ?? 0) - (a[0] ?? 0) || (b[1] ?? 0) - (a[1] ?? 0) || (b[2] ?? 0) - (a[2] ?? 0),
    )
    .map((version) => `danwo ${version.join(".")}`)
}

test("the changelog lists the releases newest first", async ({ app, screen, expect }) => {
  const [newest, previous] = releasesNewestFirst()

  await app.open("/")
  await screen
    .getByRole("navigation", { name: "Primary" })
    .getByRole("link", { name: "Docs" })
    .click()
  await screen.getByRole("banner").getByRole("link", { name: "Changelog" }).click()
  await expect(screen.getByRole("heading", { level: 1, name: "Changelog" })).toBeVisible()

  const releases = screen.getByRole("heading", { level: 2, name: /^danwo \d/ })

  await expect(releases.first()).toHaveText(newest ?? "")
  await expect(releases.nth(1)).toHaveText(previous ?? "")
})
