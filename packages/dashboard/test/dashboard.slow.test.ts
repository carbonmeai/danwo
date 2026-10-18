import { execFile } from "node:child_process"
import { cp, mkdir, rm, symlink, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

import { openWebSession, type WebSession } from "@danwo/runner"
import { afterAll, beforeAll, describe, it } from "vitest"

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
  await rm(WORK, { recursive: true, force: true })
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

beforeAll(async () => {
  await project()
  dashboard = await startDashboard({ root: WORK, port: 0 })
  session = await openWebSession({ baseUrl: dashboard.url })
}, 300_000)

afterAll(async () => {
  await session?.close()
  await dashboard?.close()
  await rm(WORK, { recursive: true, force: true })
})

describe("danwo serve", () => {
  it("lists the test run and the matrix run", async () => {
    const { app, screen, expect } = session

    await app.open("/")
    await expect(screen.getByRole("heading", { name: "Runs" })).toBeVisible({ timeout: 60_000 })
    await expect(screen.getByText("danwo matrix", { exact: true })).toBeVisible()
    await expect(screen.getByText("danwo test", { exact: true })).toBeVisible()
    await expect(screen.getByRole("link", { name: "3 tests" })).toBeVisible()
  })

  it("opens a failed test's flight record with its steps and screenshot", async () => {
    const { app, screen, expect } = session

    await app.open("/")
    await screen.getByRole("link", { name: "3 tests" }).click()
    await expect(
      screen.getByText("tests/broken.danwo.ts › shows a heading the shop does not have"),
    ).toBeVisible()
    await screen.getByRole("link", { name: "attempt 1" }).click()
    await expect(screen.getByRole("region", { name: "Steps" })).toBeVisible()
    await expect(screen.getByText("EXPECTATION_FAILED", { exact: false }).first()).toBeVisible()
    await expect(screen.getByRole("img", { name: /Screenshot after the step/ })).toBeVisible({
      timeout: 30_000,
    })
    await expect(screen.getByRole("region", { name: "Failure page" })).toBeVisible()
  })

  it("shows the matrix as a grid of faults, the duplicate webhook failed", async () => {
    const { app, screen, expect } = session

    await app.open("/")
    await screen.getByRole("link", { name: /buys 500 credits/ }).click()
    await expect(screen.getByRole("list", { name: "Faults" })).toBeVisible()

    const duplicate = screen
      .getByRole("listitem")
      .filter({ hasText: "duplicate on webhook checkout.session.completed" })

    await expect(duplicate).toContainText("failed")
    await expect(duplicate).toContainText("expected 1000 to be 500")
    await expect(
      screen.getByRole("listitem").filter({ hasText: "status 500 on POST api.stripe.com" }),
    ).toContainText("passed")
  })

  it("shows the impact index and the insights", async () => {
    const { app, screen, expect } = session

    await app.open("/impact")
    await expect(screen.getByText("api.stripe.com").first()).toBeVisible({ timeout: 30_000 })
    await app.open("/insights")
    await expect(screen.getByRole("heading", { name: "Slowest tests" })).toBeVisible()
  })
})
