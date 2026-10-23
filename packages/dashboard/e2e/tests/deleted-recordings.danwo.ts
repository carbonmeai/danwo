import { readdir, rm } from "node:fs/promises"
import { join } from "node:path"

import { test } from "@danwo/sdk"

import { PROJECT } from "../project.ts"
import { openPage } from "./dashboard.ts"

test("marks a run whose recordings were deleted, and explains it inside the overlay", async (page) => {
  const { screen, expect } = page
  const runs = join(PROJECT, ".danwo", "runs")
  /* The oldest run is the failing test's alone, kept apart for this test. */
  const run = (await readdir(runs)).toSorted()[0] ?? ""
  const attempt = (await readdir(join(runs, run))).find((name) => name.includes("heading"))
  const record = `.danwo/runs/${run}/${attempt ?? ""}/attempt-1`

  await rm(join(runs, run), { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  await openPage(page, `/runs/${run}`)

  const row = screen.getByRole("row").filter({ hasText: "shows a heading" })

  await expect(row.getByText("recording deleted")).toBeVisible({ timeout: 30_000 })
  await expect(row.getByRole("button", { name: "Watch (recording deleted)" })).toHaveAttribute(
    "aria-disabled",
    "true",
  )
  await openPage(page, `/runs/${run}?open=${encodeURIComponent(record)}`)

  const dialog = screen.getByRole("dialog")

  await expect(dialog.getByText("This recording was deleted")).toBeVisible({ timeout: 30_000 })
  await expect(dialog.getByText(/Only the latest 50 runs keep recordings/)).toBeVisible()
  await expect(dialog.getByRole("button", { name: /Rerun tests\/broken\.danwo\.ts/ })).toBeVisible()
  await dialog.getByRole("button", { name: "Close" }).first().click()
  await expect(screen.getByRole("dialog")).toHaveCount(0)
})
