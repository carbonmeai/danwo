/**
 * A test that connects an account through the provider's popup: every step records the tab it ran
 * in, each tab keeps a video of its own, and the dashboard's player follows the run into the popup
 * and back. Beside it, a screenshot taken with the filmed pointer on the page matches a baseline
 * taken with no video at all, so the pointer never shows in a compared picture.
 */
import { execFile } from "node:child_process"
import { existsSync } from "node:fs"
import { glob, readFile, stat } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import { type Dashboard, startDashboard } from "@danwo/dashboard"
import { openWebSession, type WebSession } from "@danwo/runner"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { z } from "zod"

import { removeWorkCopies, workCopy } from "./work-copy.ts"

const BIN = fileURLToPath(new URL("../src/bin.ts", import.meta.url))
const APP = workCopy(fileURLToPath(new URL("./fixtures/connect-popup", import.meta.url)))

/** Runs `danwo <args>` in the fixture; resolves to its exit code and output. */
function danwo(args: readonly string[]): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [BIN, ...args],
      { cwd: APP, env: { ...process.env, NO_COLOR: "1" } },
      (error, stdout, stderr) => {
        const code = error === null ? 0 : typeof error.code === "number" ? error.code : 1

        resolve({ code, out: `${stdout}${stderr}` })
      },
    )
  })
}

const Record = z.object({
  test: z.string(),
  status: z.string(),
  steps: z.array(z.object({ index: z.number(), api: z.string(), tab: z.number().optional() })),
  videos: z
    .array(
      z.object({
        file: z.string(),
        tab: z.number(),
        opener: z.number().optional(),
        host: z.string().optional(),
        closed: z.boolean().optional(),
      }),
    )
    .optional(),
})

/** The newest run's record of the test named `name`, with its folder relative to the fixture. */
async function newestRecord(
  name: string,
): Promise<{ dir: string; record: z.infer<typeof Record> }> {
  const paths: string[] = []

  for await (const path of glob(".danwo/runs/*/*/attempt-1/record.json", { cwd: APP }))
    paths.push(path)

  for (const path of paths.toSorted().toReversed()) {
    const record = Record.parse(JSON.parse(await readFile(join(APP, path), "utf8")))

    if (record.test.endsWith(name)) return { dir: dirname(path), record }
  }

  throw new Error(`no record of ${name}`)
}

const CONNECT = "connects an account through the provider's popup"
const LOOK = "the settings page looks as it did, the pointer drawn or not"

let dashboard: Dashboard | undefined
let session: WebSession | undefined

beforeAll(async () => {
  /* The baseline is taken with no video, so no pointer is drawn into the page. */
  const baseline = await danwo(["test", "--video", "off", "--grep", "looks as it did"])

  expect(baseline.out).toContain("1 passed")

  const filmed = await danwo(["test"])

  expect(filmed.out).toContain("2 passed")
  expect(filmed.code).toBe(0)
}, 180_000)

afterAll(async () => {
  await session?.close()
  await dashboard?.close()
  removeWorkCopies()
}, 60_000)

describe("a popup in the recording", () => {
  it("records each step's tab, and a video of each tab with who opened it", async () => {
    const { dir, record } = await newestRecord(CONNECT)

    expect(record.steps.map((step) => [step.api, step.tab])).toEqual([
      ["app.open", 1],
      ["locator.click", 1],
      ["expect.toBeVisible", 2],
      ["locator.fill", 2],
      ["locator.click", 2],
      ["expect.toBeVisible", 1],
    ])
    expect(
      record.videos?.map(({ file, tab, opener, closed }) => [file, tab, opener, closed]),
    ).toEqual([
      ["video/tab-1.webm", 1, undefined, undefined],
      ["video/tab-2.webm", 2, 1, true],
    ])
    expect(record.videos?.[1]?.host).toMatch(/^localhost:\d+$/)

    for (const file of ["tab-1.webm", "tab-2.webm"])
      expect((await stat(join(APP, dir, "video", file))).size).toBeGreaterThan(1_000)
  })

  it("matches a baseline taken with no pointer, with the pointer on the page", async () => {
    const { record } = await newestRecord(LOOK)

    expect(record.status).toBe("passed")
    expect(record.videos?.map((video) => video.file)).toEqual(["video/tab-1.webm"])
    expect(
      existsSync(
        join(
          APP,
          "tests",
          "__screenshots__",
          "look.danwo.ts",
          "the-settings-page-looks-as-it-did-the-pointer-drawn-or-not",
          "settings.png",
        ),
      ),
    ).toBe(true)
  })

  it("plays the popup's steps in the popup's video, and comes back to the app's", async () => {
    const { dir } = await newestRecord(CONNECT)

    dashboard = await startDashboard({ root: APP, port: 0 })
    session = await openWebSession({ baseUrl: dashboard.url })

    const { screen, expect: see } = session
    const video = screen.getByLabel(/^Video of the run, tab /)

    await session.app.open(`/records/${dir}`)
    await see(screen.getByTestId("dashboard-ready")).toHaveCount(1, { timeout: 60_000 })
    await see(video).toHaveAttribute("aria-label", "Video of the run, tab 1", { timeout: 30_000 })
    await see(screen.getByText(/^Popup opened: localhost:\d+$/)).toBeVisible()
    await see(screen.getByText("Back to the app", { exact: true })).toBeVisible()
    await see(screen.getByText("popup", { exact: true })).toHaveCount(3)

    /* Going to a step in the popup shows the popup's video. */
    await screen.getByRole("button", { name: /^Go to step 4, at / }).click()
    await see(video).toHaveAttribute("aria-label", "Video of the run, tab 2")
    await see(video).toHaveAttribute("src", /\/video\/tab-2\.webm$/)

    /* Played from the start, the player follows the run into the popup and back. */
    await screen.getByRole("button", { name: /^Go to step 1, at / }).click()
    await see(video).toHaveAttribute("aria-label", "Video of the run, tab 1")
    await screen.getByRole("button", { name: "Play" }).click()
    await see(video).toHaveAttribute("aria-label", "Video of the run, tab 2", { timeout: 15_000 })
    await see(video).toHaveAttribute("aria-label", "Video of the run, tab 1", { timeout: 15_000 })
  }, 180_000)
})
