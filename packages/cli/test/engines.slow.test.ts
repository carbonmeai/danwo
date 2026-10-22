/**
 * The same suite in Firefox and WebKit: locators, a screenshot compared with each engine's own
 * baseline, an agent step recorded by the model and then replayed from the cache with no model
 * call, and a Stripe call the page makes through danwo's proxy to the emulator, over HTTPS the
 * engine trusts. Each engine's part is skipped on a machine where danwo's build of it is not
 * installed (`danwo install-browser --browser firefox,webkit`).
 */
import { execFile } from "node:child_process"
import { existsSync } from "node:fs"
import { readdir, readFile, rm } from "node:fs/promises"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

import { browserInstalled } from "@danwo/runner"
import { afterAll, describe, expect, it } from "vitest"
import { z } from "zod"

import { removeWorkCopies, workCopy } from "./work-copy.ts"

const BIN = fileURLToPath(new URL("../src/bin.ts", import.meta.url))
const SHOP = workCopy(fileURLToPath(new URL("./fixtures/engines", import.meta.url)))
const TEST = "tests/shop.danwo.ts › creates a Stripe product from the page"
const BASELINES = join(SHOP, "tests", "__screenshots__", "shop.danwo.ts")

afterAll(removeWorkCopies)

/** Runs `danwo <args>` in the fixture; resolves to its exit code and output. */
function danwo(args: readonly string[]): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [BIN, ...args],
      { cwd: SHOP, env: { ...process.env, NO_COLOR: "1" } },
      (error, stdout, stderr) => {
        const code = error === null ? 0 : typeof error.code === "number" ? error.code : 1

        resolve({ code, out: `${stdout}${stderr}` })
      },
    )
  })
}

const Record = z.object({
  test: z.string(),
  browser: z.string().optional(),
  exchanges: z.array(z.object({ method: z.string(), host: z.string(), path: z.string() })),
  videos: z.array(z.object({ file: z.string() })).optional(),
})

/** The newest run's records, by the folder each test's attempt kept. */
async function newestRecords(): Promise<{ dir: string; record: z.infer<typeof Record> }[]> {
  const runs = join(SHOP, ".danwo", "runs")
  const run = join(runs, (await readdir(runs)).toSorted().at(-1) ?? "")
  const tests = await readdir(run, { withFileTypes: true })

  return Promise.all(
    tests
      .filter((entry) => entry.isDirectory())
      .map(async (entry) => {
        const dir = join(run, entry.name, "attempt-1")

        return {
          dir,
          record: Record.parse(JSON.parse(await readFile(join(dir, "record.json"), "utf8"))),
        }
      }),
  )
}

const installed = {
  firefox: (await browserInstalled("firefox")).ok,
  webkit: (await browserInstalled("webkit")).ok,
}

for (const engine of ["firefox", "webkit"] as const) {
  describe.skipIf(!installed[engine])(`the suite in ${engine}`, () => {
    it("records the agent's step, writes the engine's own baseline, and calls Stripe through the proxy", async () => {
      await rm(join(SHOP, ".danwo-cache"), { recursive: true, force: true })

      const { code, out } = await danwo(["test", "--browser", engine])

      expect(out).toContain(`Running 1 test in ${engine} with 1 worker`)
      expect(out).toContain(`✓ ${TEST} [${engine}]`)
      expect(out).toContain("1 recorded")
      expect(code).toBe(0)
      expect(
        existsSync(
          join(BASELINES, `creates-a-stripe-product-from-the-page-${engine}`, "heading.png"),
        ),
      ).toBe(true)

      const [kept] = await newestRecords()

      expect(kept?.record).toMatchObject({ test: TEST, browser: engine })
      expect(kept?.record.exchanges.map((e) => `${e.method} ${e.host}${e.path}`)).toContain(
        "POST api.stripe.com/v1/products",
      )
      expect(kept?.record.videos?.map((video) => video.file)).toEqual(["video/tab-1.webm"])
      expect(existsSync(join(kept?.dir ?? "", "video", "tab-1.webm"))).toBe(true)
    })

    it("replays the step from the cache with no model call, and matches its baseline", async () => {
      const { code, out } = await danwo(["test", "--browser", engine, "--replay-only"])

      expect(out).toContain(`✓ ${TEST} [${engine}]`)
      expect(out).toContain("cache: 1 replayed")
      expect(out).toContain("model: 0 calls (replay-only)")
      expect(code).toBe(0)
    })
  })
}

describe.skipIf(!installed.webkit)("the matrix in WebKit", () => {
  it("sends Buy twice at once though WebKit cannot be handed a redirect", async () => {
    const lamp = workCopy(fileURLToPath(new URL("./fixtures/last-item", import.meta.url)))
    const { code, out } = await new Promise<{ code: number; out: string }>((resolve) => {
      execFile(
        process.execPath,
        [BIN, "matrix", "tests/lamp.danwo.ts", "--browser", "webkit", "--faults", "double"],
        { cwd: lamp, env: { ...process.env, NO_COLOR: "1" } },
        (error, stdout, stderr) =>
          resolve({
            code: error === null ? 0 : Number(error.code ?? 1),
            out: `${stdout}${stderr}`,
          }),
      )
    })

    expect(out).toContain("PASS  double-submit on POST /buy")
    expect(out).toMatch(/POST \/buy sent twice at once: 303 and 303/)
    expect(code).toBe(0)
  })
})

describe.skipIf(!installed.firefox || !installed.webkit)(
  "the suite in both engines at once",
  () => {
    it("runs every test once in each, each result and record labelled with its engine", async () => {
      const { code, out } = await danwo(["test", "--browser", "firefox,webkit", "--replay-only"])

      expect(out).toContain("Running 2 tests (1 in each of firefox, webkit) with 1 worker")
      expect(out).toContain(`✓ ${TEST} [firefox]`)
      expect(out).toContain(`✓ ${TEST} [webkit]`)
      expect(out).toContain("cache: 2 replayed")
      expect(code).toBe(0)
      expect(
        (await newestRecords())
          .map(({ record }) => record.browser ?? "")
          .toSorted((a, b) => a.localeCompare(b)),
      ).toEqual(["firefox", "webkit"])
    })
  },
)
