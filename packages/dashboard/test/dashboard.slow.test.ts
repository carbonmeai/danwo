import { execFile } from "node:child_process"
import { cp, mkdir, rm, symlink, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

import { openWebSession, type WebSession } from "@danwo/runner"
import { afterAll, beforeAll, describe, expect as check, it } from "vitest"

import { type Dashboard, startDashboard } from "../src/index.ts"

const REPO = fileURLToPath(new URL("../../..", import.meta.url))
const SHOP = join(REPO, "examples", "shop")
const BIN = join(REPO, "packages", "cli", "bin", "danwo.mjs")
const WORK = fileURLToPath(new URL(`./.work-${process.pid}`, import.meta.url))

/** A test the shop cannot pass, so the run keeps a failed attempt with steps and screenshots. */
const BROKEN = `import { test } from "@danwo/sdk"

test("shows a heading the shop does not have", async ({ app, screen, expect }) => {
  await app.open("/")
  await expect(screen.getByRole("heading", { name: "Not on this page" })).toBeVisible({ timeout: 1_000 })
})
`

function danwo(args: readonly string[], env: NodeJS.ProcessEnv = {}): Promise<void> {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [BIN, ...args],
      { cwd: WORK, env: { ...process.env, NO_COLOR: "1", ...env } },
      () => resolve(),
    )
  })
}

/** The shop example as a project of its own, with one failing test, after a test run and a matrix run. */
async function project(): Promise<void> {
  await rm(WORK, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  await mkdir(join(WORK, "tests"), { recursive: true })
  await cp(join(SHOP, "src"), join(WORK, "src"), { recursive: true })
  await cp(join(SHOP, "tests"), join(WORK, "tests"), { recursive: true })
  await cp(join(SHOP, "danwo.config.ts"), join(WORK, "danwo.config.ts"))
  await cp(join(SHOP, "package.json"), join(WORK, "package.json"))
  await symlink(join(SHOP, "node_modules"), join(WORK, "node_modules"))
  await writeFile(join(WORK, "tests", "broken.danwo.ts"), BROKEN)
  await danwo(["test"])
  await danwo(
    ["matrix", "tests/buy-credits.danwo.ts", "--faults", "duplicate|status 500 on POST"],
    {
      SHOP_BUG: "no-dedupe",
    },
  )
}

let dashboard: Dashboard
let session: WebSession

/**
 * Opens a dashboard page and waits until React has hydrated it, so a click lands on a live
 * control rather than the server's HTML; a busy machine can take seconds to get there.
 */
async function open(path: string): Promise<void> {
  await session.app.open(path)
  await session.expect(session.screen.getByTestId("dashboard-ready")).toHaveCount(1, {
    timeout: 60_000,
  })
}

beforeAll(async () => {
  await project()
  dashboard = await startDashboard({ root: WORK, port: 0 })
  session = await openWebSession({ baseUrl: dashboard.url })
}, 300_000)

afterAll(async () => {
  await session?.close()
  await dashboard?.close()
  await rm(WORK, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
}, 120_000)

describe("danwo serve", () => {
  it("opens on the overview, and lists the test run and the matrix run", async () => {
    const { screen, expect } = session

    await open("/")
    await expect(screen.getByRole("heading", { name: "Overview" })).toBeVisible({ timeout: 60_000 })
    await expect(screen.getByRole("region", { name: "Breaks under faults" })).toContainText(
      "duplicate on webhook checkout.session.completed",
    )
    await screen.getByRole("link", { name: "Runs", exact: true }).click()
    await expect(screen.getByText("danwo matrix", { exact: true })).toBeVisible()
    await expect(screen.getByText("danwo test", { exact: true })).toBeVisible()
    await expect(screen.getByRole("link", { name: "3 tests" })).toBeVisible()
  })

  it("lists every test in the library with what the matrix made of it", async () => {
    const { screen, expect } = session

    await open("/tests")

    const tests = screen.getByRole("table", { name: "Tests" })

    await expect(tests.getByRole("row").filter({ hasText: "buys 500 credits" })).toContainText(
      "breaks under: duplicate on webhook",
    )
    await expect(tests.getByRole("row").filter({ hasText: "shows a heading" })).toContainText(
      "failed",
    )
  })

  it("opens a failed test's recording over the page, and closes it with Esc", async () => {
    const { screen, expect } = session

    await open("/runs")
    await screen.getByRole("link", { name: "3 tests" }).click()
    await screen
      .getByRole("row")
      .filter({ hasText: "shows a heading" })
      .getByRole("link", { name: "Watch" })
      .click()

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

  it("shows the matrix as a grid of faults, the duplicate webhook failed", async () => {
    const { screen, expect } = session

    await open("/runs?kind=matrix")
    await screen.getByRole("link", { name: /buys 500 credits/ }).click()
    await expect(
      screen.getByRole("button", {
        name: /duplicate on webhook checkout\.session\.completed: failed/,
      }),
    ).toBeVisible()
    await screen.getByRole("tab", { name: "List" }).click()
    await expect(screen.getByRole("list", { name: "Faults" })).toBeVisible()

    const duplicate = screen
      .getByRole("listitem")
      .filter({ hasText: "duplicate on webhook checkout.session.completed" })

    await expect(duplicate).toContainText("failed")
    await expect(duplicate).toContainText("expected 1000 to be 500")
  })

  it("replays a failed test's video, seeking it from a step and from a link", async () => {
    const { screen, expect } = session

    await open("/runs")
    await screen.getByRole("link", { name: "3 tests" }).click()
    await screen
      .getByRole("row")
      .filter({ hasText: "shows a heading" })
      .getByRole("link", { name: "Watch" })
      .click()

    const seek = screen.getByRole("slider", { name: "Seek" })
    const video = screen.getByLabel("Video of the run")

    await expect(video).toHaveAttribute("src", /^\/media\/.+\/video\/tab-1\.webm$/, {
      timeout: 30_000,
    })
    await screen.getByRole("button", { name: /^Go to step 2, at / }).click()
    await expect(seek).not.toHaveAttribute("aria-valuetext", "0:00.0")

    const src = (await video.getAttribute("src")) ?? ""
    const part = await fetch(new URL(src, dashboard.url), { headers: { range: "bytes=0-99" } })

    check(part.status).toBe(206)
    check(part.headers.get("content-type")).toBe("video/webm")

    const dir = `.danwo/runs/${decodeURIComponent(src.replace(/^\/media\/|\/video\/tab-1\.webm$/g, ""))}`

    await open(`/records/${dir}?t=0.5`)
    await expect(seek).toHaveAttribute("aria-valuetext", "0:00.5", { timeout: 30_000 })
  })

  it("runs a matrix from the dashboard and shows it live until it becomes the run's page", async () => {
    const { screen, expect } = session

    await open("/runs?kind=matrix")
    await screen.getByRole("link", { name: /buys 500 credits/ }).click()
    await screen.getByRole("button", { name: "Run the matrix" }).click()
    await screen.getByRole("textbox", { name: "Only faults containing" }).fill("on POST /buy")
    await screen.getByRole("button", { name: "Run", exact: true }).click()

    await expect(screen.getByText("running", { exact: true }).first()).toBeVisible({
      timeout: 60_000,
    })
    await expect(screen.getByRole("table", { name: "Fault grid" })).toBeVisible({
      timeout: 120_000,
    })
    await expect(screen.getByRole("button", { name: /double-submit on POST \/buy/ })).toBeVisible()
  })

  it("reruns one test from its run and opens the new run", async () => {
    const { screen, expect } = session

    await open("/runs")
    await screen.getByRole("link", { name: "3 tests" }).click()
    await screen.getByRole("button", { name: /Rerun tests\/storefront\.danwo\.ts/ }).click()
    await expect(screen.getByRole("heading", { name: "1 test" })).toBeVisible({ timeout: 60_000 })
    await open("/runs")
    await expect(screen.getByRole("link", { name: "1 test" })).toBeVisible()
  })

  it("shows the impact index, the insights, the matrix and the settings", async () => {
    const { screen, expect } = session

    await open("/impact")
    await expect(screen.getByText("api.stripe.com").first()).toBeVisible({ timeout: 30_000 })
    await open("/insights?sort=faults")
    await expect(screen.getByRole("heading", { name: "Slowest tests" })).toBeVisible()
    await open("/matrix")
    await expect(
      screen
        .getByRole("table", { name: "Tests under the matrix" })
        .getByRole("row")
        .filter({ hasText: "buys 500 credits" }),
    ).toContainText(/held|broke under/)
    await open("/settings")
    await expect(screen.getByText("danwo.config.ts", { exact: true })).toBeVisible()
  })
})
