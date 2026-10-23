/** What the dashboard's tests share: opening a page once it can be clicked. */
import type { DanwoFixtures } from "@danwo/sdk"

type Page = Pick<DanwoFixtures, "app" | "screen" | "expect">

/**
 * Opens a dashboard page and waits until React has hydrated it, so a click lands on a live
 * control rather than the server's HTML; a busy machine can take seconds to get there.
 */
export async function openPage({ app, screen, expect }: Page, path: string): Promise<void> {
  await app.open(path)
  await expect(screen.getByTestId("dashboard-ready")).toHaveCount(1, { timeout: 60_000 })
}

/** Opens the run of every test (the one with three) at its list of tests. */
export async function openFullRun(page: Page): Promise<void> {
  await openPage(page, "/runs")
  await page.screen.getByRole("link", { name: "3 tests" }).click()
}

/** Opens the recording of the test whose row says `title`, from the run's list of tests. */
export async function watch({ screen }: Page, title: string): Promise<void> {
  await screen
    .getByRole("row")
    .filter({ hasText: title })
    .getByRole("link", { name: "Watch" })
    .click()
}
