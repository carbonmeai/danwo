import { test } from "@danwo/sdk"

import { openFullRun, openPage, watch } from "./dashboard.ts"

test("opens a failed test's recording over the page, and closes it with Esc", async (page) => {
  const { screen, expect } = page

  await openFullRun(page)
  await watch(page, "shows a heading")

  const dialog = screen.getByRole("dialog")

  await expect(dialog.getByRole("list", { name: "Steps" })).toBeVisible({ timeout: 30_000 })
  await expect(dialog.getByText("EXPECTATION_FAILED", { exact: false }).first()).toBeVisible()
  await expect(dialog.getByRole("button", { name: "Copy prompt to fix" })).toBeVisible()
  await dialog.getByRole("tab", { name: "Network" }).click()
  await expect(dialog.getByRole("table", { name: "Network" })).toBeVisible()
  await dialog.getByRole("tab", { name: "Console" }).click()
  await expect(dialog.getByRole("tablist", { name: "Log level" })).toBeVisible()
  await dialog.getByRole("tab", { name: "Console" }).press("Escape")
  await expect(screen.getByRole("dialog")).toHaveCount(0)
})

test("lists a passing test's checks after its steps, and shades settling on the scrubber", async (page) => {
  const { screen, expect } = page

  await openFullRun(page)
  await watch(page, "buys 500 credits")

  const checks = screen.getByRole("dialog").getByRole("list", { name: "Checks" })
  const passed = checks.getByRole("listitem").filter({ hasText: /^expect\(.+\)\.toBe\(/ })

  await expect(checks).toBeVisible({ timeout: 30_000 })
  await expect(passed.getByRole("img", { name: "Passed" })).toBeVisible()
  await expect(passed).toContainText("got ")
  await expect(checks).toContainText("Waiting for background work")
  await expect(screen.getByRole("button", { name: /^Go to settling, at / })).toBeVisible()
  await expect(screen.getByRole("button", { name: /Idle at 4×/ })).toHaveAttribute(
    "aria-pressed",
    "true",
  )
  await screen.getByRole("dialog").press("Escape")
})

test("replays a failed test's video, seeking it from a step and from a link", async (page) => {
  const { app, screen, expect } = page

  await openFullRun(page)
  await watch(page, "shows a heading")

  const seek = screen.getByRole("slider", { name: "Seek" })
  const video = screen.getByLabel("Video of the run")

  await expect(video).toHaveAttribute("src", /^\/media\/.+\/video\/tab-1\.webm$/, {
    timeout: 30_000,
  })
  await screen.getByRole("button", { name: /^Go to step 2, at / }).click()
  await expect(seek).not.toHaveAttribute("aria-valuetext", "0:00.0")

  const src = (await video.getAttribute("src")) ?? ""
  /* The video streams in ranges, as a browser seeking it asks for them. */
  const part = await fetch(new URL(src, app.baseUrl), { headers: { range: "bytes=0-99" } })

  expect(part.status).toBe(206)
  expect(part.headers.get("content-type")).toBe("video/webm")

  const record = decodeURIComponent(src.replace(/^\/media\/|\/video\/tab-1\.webm$/g, ""))

  await openPage(page, `/records/.danwo/runs/${record}?t=0.5`)
  await expect(seek).toHaveAttribute("aria-valuetext", "0:00.5", { timeout: 30_000 })
})

test("says whose failure a failed test was, on its row and over its recording", async (page) => {
  const { screen, expect } = page

  await openFullRun(page)

  const row = screen.getByRole("row").filter({ hasText: "shows a heading" })

  await expect(row.getByLabel(/^(App bug|Test issue)\./)).toBeVisible({ timeout: 30_000 })
  await row.getByRole("link", { name: "Watch" }).click()

  const dialog = screen.getByRole("dialog")

  await expect(dialog.getByLabel(/^(App bug|Test issue)\./)).toBeVisible({ timeout: 30_000 })
  await dialog.getByRole("list", { name: "Steps" }).press("Escape")
  await openPage(page, "/runs?verdict=environment")
  await expect(screen.getByText("No runs match")).toBeVisible()
})
