import { execFile } from "node:child_process"
import { existsSync } from "node:fs"
import { cp, mkdir, readdir, readFile, rm, stat, symlink, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

import type { FlightRecord } from "@danwo/runner/runner"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

const BIN = fileURLToPath(new URL("../src/bin.ts", import.meta.url))
const SHOP = fileURLToPath(new URL("../../../examples/shop", import.meta.url))
const WORK = fileURLToPath(new URL(`./.work-video-${process.pid}`, import.meta.url))

/** A test the shop cannot pass, so its run keeps a record and a video. */
const BROKEN = `import { test } from "@danwo/sdk"

test("shows a heading the shop does not have", async ({ app, screen, expect }) => {
  await app.open("/")
  await expect(screen.getByRole("heading", { name: "Not on this page" })).toBeVisible({ timeout: 1_000 })
})
`

function danwo(args: readonly string[]): Promise<string> {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [BIN, ...args],
      { cwd: WORK, env: { ...process.env, NO_COLOR: "1" } },
      (_error, stdout, stderr) => resolve(`${stdout}${stderr}`),
    )
  })
}

/** The records of the newest run, by the test they belong to. */
async function newestRecords(): Promise<Map<string, { dir: string; record: FlightRecord }>> {
  const runs = join(WORK, ".danwo", "runs")
  const run = join(runs, (await readdir(runs)).toSorted().at(-1) ?? "")
  const found = new Map<string, { dir: string; record: FlightRecord }>()

  for (const test of await readdir(run, { withFileTypes: true })) {
    const dir = join(run, test.name, "attempt-1")

    /* A passing test's attempt is dropped under on-failure; its test folder stays empty. */
    if (!existsSync(join(dir, "record.json"))) continue

    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the record danwo just wrote
    const record = JSON.parse(await readFile(join(dir, "record.json"), "utf8")) as FlightRecord

    found.set(record.test, { dir, record })
  }

  return found
}

/** How long a video file plays, by ffprobe when it is installed. */
function probedMs(file: string): Promise<number | undefined> {
  return new Promise((resolve) => {
    execFile(
      "ffprobe",
      ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file],
      (error, stdout) => resolve(error === null ? Number(stdout) * 1000 : undefined),
    )
  })
}

beforeAll(async () => {
  await rm(WORK, { recursive: true, force: true })
  await mkdir(join(WORK, "tests"), { recursive: true })
  await cp(join(SHOP, "src"), join(WORK, "src"), { recursive: true })
  await cp(join(SHOP, "tests"), join(WORK, "tests"), { recursive: true })
  await cp(join(SHOP, "danwo.config.ts"), join(WORK, "danwo.config.ts"))
  await cp(join(SHOP, "package.json"), join(WORK, "package.json"))
  await symlink(join(SHOP, "node_modules"), join(WORK, "node_modules"))
  await writeFile(join(WORK, "tests", "broken.danwo.ts"), BROKEN)
}, 60_000)

afterAll(async () => {
  await rm(WORK, { recursive: true, force: true })
})

const BROKEN_ID = "tests/broken.danwo.ts › shows a heading the shop does not have"
const CHECKOUT_ID = "tests/buy-credits.danwo.ts › buys 500 credits through Stripe Checkout"

describe("video in the flight record", () => {
  it("films a failed test, with every step and call inside the video", async () => {
    await danwo(["test"])

    const { dir, record } = (await newestRecords()).get(BROKEN_ID) ?? {}
    const video = record?.videos?.[0]

    expect(video).toMatchObject({ file: "video/tab-1.webm", tab: 1 })

    const file = join(dir ?? "", video?.file ?? "")

    expect((await stat(file)).size).toBeGreaterThan(1_000)
    expect(existsSync(join(dir ?? "", "video", "raw"))).toBe(false)

    const length = (await probedMs(file)) ?? video?.durationMs ?? 0
    const steps = video?.marks.filter((mark) => mark.kind === "step") ?? []

    expect(steps.map((mark) => mark.id)).toEqual(record?.steps.map((step) => String(step.index)))
    expect(video?.marks.some((mark) => mark.kind === "call")).toBe(true)

    for (const mark of video?.marks ?? []) {
      expect(mark.startMs, mark.label).toBeGreaterThanOrEqual(0)
      expect(mark.endMs, mark.label).toBeLessThanOrEqual(length)
    }

    const report = await readFile(join(dir ?? "", "..", "..", "report.html"), "utf8")

    expect(report).toContain('<video class="film"')
  })

  it("keeps a passing run's record without video under retain-on-failure, with it under on", async () => {
    await danwo(["test", "--record", "always", "--grep", "buys 500 credits"])

    const plain = (await newestRecords()).get(CHECKOUT_ID)

    expect(plain?.record.status).toBe("passed")
    expect(plain?.record.videos).toBeUndefined()
    expect(existsSync(join(plain?.dir ?? "", "video"))).toBe(false)

    await danwo(["test", "--record", "always", "--video", "on", "--grep", "buys 500 credits"])

    const filmed = (await newestRecords()).get(CHECKOUT_ID)
    const video = filmed?.record.videos?.[0]
    const webhook = video?.marks.find((mark) => mark.kind === "webhook")

    expect(video?.marks.filter((mark) => mark.kind === "step")).toHaveLength(
      filmed?.record.steps.length ?? -1,
    )
    expect(webhook?.label).toContain("checkout.session.completed")
    expect(webhook?.startMs).toBeGreaterThan(0)
    expect(existsSync(join(filmed?.dir ?? "", video?.file ?? "missing"))).toBe(true)
  })

  it("films nothing with --video off", async () => {
    await danwo(["test", "--video", "off", "--grep", "heading the shop"])

    const { dir, record } = (await newestRecords()).get(BROKEN_ID) ?? {}

    expect(record?.status).toBe("failed")
    expect(record?.videos).toBeUndefined()
    expect(existsSync(join(dir ?? "", "video"))).toBe(false)
  })
})
