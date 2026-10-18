import { execFile } from "node:child_process"
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

import type { Page } from "playwright-core"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { type RecordedTest, startRecording } from "../src/index.ts"

/* The shop example's config, from a folder of its own so recorded tests stay out of the example. */
const SHOP = fileURLToPath(new URL("./fixtures/shop", import.meta.url))
const SESSIONS = fileURLToPath(new URL("../../cli/test/fixtures/sessions", import.meta.url))
const SIGNUP = fileURLToPath(new URL("./fixtures/signup", import.meta.url))
const BIN = fileURLToPath(new URL("../../cli/src/bin.ts", import.meta.url))
const written: string[] = []

afterAll(async () => {
  for (const path of written) await rm(path, { force: true })
  for (const dir of [SHOP, SESSIONS, SIGNUP])
    await rm(join(dir, ".danwo"), { recursive: true, force: true })
})

/** Runs `danwo <args>` under Node in `cwd`. */
function danwo(cwd: string, args: readonly string[], env: NodeJS.ProcessEnv = {}) {
  return new Promise<{ code: number; out: string }>((resolve) => {
    execFile(
      process.execPath,
      [BIN, ...args],
      { cwd, env: { ...process.env, NO_COLOR: "1", ...env } },
      (error, stdout, stderr) => {
        const code = error === null ? 0 : typeof error.code === "number" ? error.code : 1

        resolve({ code, out: `${stdout}${stderr}` })
      },
    )
  })
}

/** Presses one of the recording toolbar's buttons. */
async function toolbar(page: Page, action: "assert" | "stop"): Promise<void> {
  await page.locator(`danwo-recorder button[data-action=${action}]`).click()
}

/** Stops a recording from its toolbar and writes its test. */
async function stopAndWrite(
  recording: Awaited<ReturnType<typeof startRecording>>,
  out: string,
  name: string,
): Promise<RecordedTest> {
  await toolbar(recording.page, "stop")
  await recording.stopped

  const recorded = await recording.finish({ out, name })

  written.push(recorded.path)

  return recorded
}

describe("danwo record on the shop", () => {
  const out = "tests/recorded-shop.danwo.ts"
  let recorded: RecordedTest

  it("writes locators, what each step caused behind the app, and a drafted invariant", async () => {
    const recording = await startRecording({ cwd: SHOP, path: "/", headless: true })
    const { page } = recording

    await page.getByRole("button", { name: "Buy 500 credits" }).click()
    await page.getByTestId("checkout-pay").click()
    await page.getByText("Credits: 500").waitFor({ timeout: 15_000 })
    await toolbar(page, "assert")
    await page.getByText(/^Credits: /).click()

    recorded = await stopAndWrite(recording, out, "buys 500 credits (recorded)")

    const { source } = recorded

    expect(recorded.shown).toBe(out)
    expect(recorded.next).toBe(`danwo matrix ${out}`)
    expect(source).toContain('await app.open("/")')
    expect(source).toContain(
      'await screen.getByRole("button", { name: "Buy 500 credits" }).click()',
    )
    expect(source).toContain('await screen.getByRole("button", { name: "Pay $5.00" }).click()')
    expect(source).toContain(
      'await expect(screen.getByText(/^Credits: /)).toHaveText("Credits: 500")',
    )
    expect(source).toMatch(/\/\/ → POST api\.stripe\.com\/v1\/checkout\/sessions/)
    expect(source).toMatch(/\/\/ → .*webhook checkout\.session\.completed/)
    expect(source).not.toContain("127.0.0.1")
    expect(source).toContain("}).invariant(async ({ app, screen, stripe, expect }) => {")
    expect(source).toContain('await app.open("/done?user=u1")')
    expect(source).toContain("expect(shown).toBe(500 * data.length)")
    expect(await readFile(join(SHOP, out), "utf8")).toBe(source)
  })

  it("never overwrites a test file", async () => {
    const recording = await startRecording({ cwd: SHOP, headless: true })

    await expect(stopAndWrite(recording, out, "again")).rejects.toThrow(/already exists/)
  })

  it("runs green under danwo test", async () => {
    const run = await danwo(SHOP, ["test", out])

    expect(run.out).toContain("1 passed")
    expect(run.code).toBe(0)
  })

  it("passes every fault under danwo matrix on the correct shop", async () => {
    const run = await danwo(SHOP, ["matrix", out])

    expect(run.out).toMatch(/faults: \d+ passed\n/)
    expect(run.out).not.toMatch(/^FAIL/m)
    expect(run.code).toBe(0)
  })

  it("fails only on the duplicate webhook when the shop does not dedupe", async () => {
    const run = await danwo(SHOP, ["matrix", out], { SHOP_BUG: "no-dedupe" })
    const failed = run.out.split("\n").filter((line) => line.startsWith("FAIL"))

    expect(failed).toEqual(["FAIL  duplicate on webhook checkout.session.completed"])
    expect(run.code).toBe(1)
  })
})

describe("danwo record with secrets and mail", () => {
  beforeAll(async () => {
    /* The sign-in fixture app writes the sessions it hands out here. */
    process.env["DANWO_FIXTURE_STATE"] = await mkdtemp(join(tmpdir(), "danwo-record-"))
  })

  it("writes a password field as a secret by name, with its value nowhere", async () => {
    const recording = await startRecording({ cwd: SESSIONS, path: "/login", headless: true })
    const { page } = recording

    await page.getByLabel("Email").fill("ada@danwo.test")
    await page.getByLabel("Password").fill("pw-ada-fixture")
    await page.getByRole("button", { name: "Sign in" }).click()
    await page.getByRole("heading", { name: /^Notes for/ }).waitFor()

    const recorded = await stopAndWrite(recording, "tests/recorded-signin.danwo.ts", "signs in")

    expect(recorded.source).toContain(
      'await screen.getByRole("textbox", { name: "Password" }).fill(secret("password"))',
    )
    expect(recorded.source).toContain('.fill("ada@danwo.test")')
    expect(recorded.missingSecrets).toEqual([])

    const everything = [recorded.source, ...(await filesUnder(join(SESSIONS, ".danwo")))]

    expect(everything.some((text) => text.includes("pw-ada-fixture"))).toBe(false)
  })

  it("writes an emailed code as a mail reference, not the code", async () => {
    const recording = await startRecording({ cwd: SIGNUP, path: "/", headless: true })
    const { page } = recording

    await page.getByLabel("Email").fill("grace@danwo.test")
    await page.getByRole("button", { name: "Send code" }).click()
    await page.getByLabel("Code").waitFor()

    const code = await page.evaluate(() => fetch("/last-code").then((res) => res.text()))

    await page.getByLabel("Code").fill(code)
    await page.getByRole("button", { name: "Verify" }).click()
    await page.getByRole("heading", { name: "Welcome" }).waitFor()

    const recorded = await stopAndWrite(recording, "tests/recorded-signup.danwo.ts", "signs up")

    expect(recorded.source).toContain(
      'await screen.getByRole("textbox", { name: "Code" }).fill(await mail.code("grace@danwo.test"))',
    )
    expect(recorded.source).not.toContain(code)
    expect(recorded.source).toMatch(/async \(\{ app, screen, mail \}\) =>/)

    const run = await danwo(SIGNUP, ["test", "tests/recorded-signup.danwo.ts"])

    expect(run.out).toContain("1 passed")
  })
})

/** Every file's text under `dir`, or none when it does not exist. */
async function filesUnder(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true }).catch(() => [])

  return Promise.all(
    entries
      .filter((entry) => entry.isFile())
      .map((entry) => readFile(join(entry.parentPath, entry.name), "utf8")),
  )
}
