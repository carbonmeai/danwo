import { execFile } from "node:child_process"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest"

const BIN = fileURLToPath(new URL("../src/bin.ts", import.meta.url))
const fixture = (name: string) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url))
const SHOP = fileURLToPath(new URL("../../../examples/shop", import.meta.url))

let state: string

beforeEach(async () => {
  state = await mkdtemp(join(tmpdir(), "danwo-cli-"))
})

afterEach(async () => {
  await rm(state, { recursive: true, force: true })
})

// Failing runs leave flight records beside each fixture's config; they are the tests' own.
afterAll(async () => {
  for (const dir of [
    fixture("basic"),
    fixture("invariant"),
    fixture("uploads"),
    fixture("signin"),
    fixture("visual"),
    SHOP,
  ])
    await rm(join(dir, ".danwo"), { recursive: true, force: true })
  await rm(join(fixture("visual"), "tests", "__screenshots__"), { recursive: true, force: true })
})

/** Runs `danwo <args>` under Node in `cwd`; resolves to its exit code and output. */
function danwo(
  cwd: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv = {},
): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [BIN, ...args],
      { cwd, env: { ...process.env, NO_COLOR: "1", DANWO_FIXTURE_STATE: state, ...env } },
      (error, stdout, stderr) => {
        const code = error === null ? 0 : typeof error.code === "number" ? error.code : 1

        resolve({ code, out: `${stdout}${stderr}` })
      },
    )
  })
}

describe("danwo test", () => {
  it("runs files across two workers, retries, reports, and exits 1 on a failure", async () => {
    const { code, out } = await danwo(fixture("basic"), [
      "test",
      "--workers",
      "2",
      "--retries",
      "1",
    ])

    expect(out).toContain("Running 4 tests with 2 workers")
    expect(out).toMatch(/✓ tests\/pass\.danwo\.ts › page › shows the heading \d+ ms, worker \d/)
    expect(out).toMatch(/✓ tests\/pass\.danwo\.ts › page › sees the worker's fixture/)
    expect(out).toMatch(/~ tests\/flaky\.danwo\.ts › passes on its retry \(2 attempts\)/)
    expect(out).toMatch(/✗ tests\/fail\.danwo\.ts › fails its assertion \(2 attempts\)/)
    expect(out).toContain("2 passed, 1 flaky, 1 failed")
    expect(out).toContain("worker 0")
    expect(out).toContain("worker 1")
    expect(code).toBe(1)
  }, 120_000)

  it("narrows with --grep and exits 0 when everything passes", async () => {
    const { code, out } = await danwo(fixture("basic"), ["test", "--grep", "heading"])

    expect(out).toContain("Running 1 test with 1 worker")
    expect(out).toContain("1 passed")
    expect(code).toBe(0)
  }, 60_000)

  it("runs two browser tests at the same time in different workers", async () => {
    const { code, out } = await danwo(fixture("concurrent"), ["test", "--workers", "2"])
    const workers = [...out.matchAll(/✓ .* worker (\d)/g)].map((match) => match[1])

    expect(out).toContain("2 passed")
    expect(new Set(workers)).toEqual(new Set(["0", "1"]))
    expect(code).toBe(0)
  }, 60_000)

  it("fails a test whose body passes but whose invariant does not", async () => {
    const { code, out } = await danwo(fixture("invariant"), ["test", "tests/invariant.danwo.ts"])

    expect(out).toContain("✗ tests/invariant.danwo.ts › passes its body but not its invariant")
    expect(out).toContain("invariant: expected 2 to be 3")
    expect(code).toBe(1)
  }, 60_000)

  it("runs the shop example against a Stripe emulator per worker", async () => {
    const { code, out } = await danwo(SHOP, ["test"])

    expect(out).toContain("✓ tests/buy-credits.danwo.ts › buys 500 credits through Stripe Checkout")
    expect(out).toContain("2 passed")
    expect(code).toBe(0)
  }, 120_000)
})

describe("danwo test with screenshots", () => {
  it("writes a baseline, fails on a change with images in the report, and updates on request", async () => {
    const baseline = join(
      fixture("visual"),
      "tests/__screenshots__/badge.danwo.ts/badge-looks-right/badge.png",
    )

    await rm(join(fixture("visual"), "tests", "__screenshots__"), { recursive: true, force: true })

    const first = await danwo(fixture("visual"), ["test"])

    expect(first.out).toContain("1 passed")
    expect((await readFile(baseline)).length).toBeGreaterThan(0)

    const changed = await danwo(fixture("visual"), ["test"], { DANWO_BADGE_COLOUR: "#aa2255" })
    const report = /report: (.+\.html)/.exec(changed.out)?.[1]

    expect(changed.code).toBe(1)
    expect(changed.out).toMatch(
      /toHaveScreenshot\("badge"\) failed: \d+ pixels \(100\.00%\) differ/,
    )
    expect(report).toBeDefined()

    const html = await readFile(join(fixture("visual"), report ?? ""), "utf8")

    expect(html).toContain("compare-1-baseline.png")
    expect(html).toContain("compare-1-actual.png")
    expect(html).toContain("compare-1-diff.png")

    const updated = await danwo(fixture("visual"), ["test", "--update-snapshots"], {
      DANWO_BADGE_COLOUR: "#aa2255",
    })

    expect(updated.code).toBe(0)

    const after = await danwo(fixture("visual"), ["test"], { DANWO_BADGE_COLOUR: "#aa2255" })

    expect(after.code).toBe(0)
  }, 120_000)
})

describe("danwo matrix", () => {
  it("records a clean run, replays it once per fault, and judges broken bodies by the invariant", async () => {
    const { code, out } = await danwo(SHOP, ["matrix", "tests/buy-credits.danwo.ts"])

    expect(out).toContain("PASS  clean run")
    expect(out).toMatch(/clean run passed; \d+ faults planned/)
    expect(out).toContain("the test's invariant judges them")
    // Checkout never opens: the body stops there, and no payment means no credits, as it should.
    expect(out).toMatch(
      /PASS {2}status 500 on GET checkout\.stripe\.com\/checkout\/:id\n {8}body stopped at tests\/buy-credits\.danwo\.ts:\d+: expect\(getByTestId\("checkout-total"\)\)\.toContainText\("\$5\.00"\) failed/,
    )
    expect(out).toContain("PASS  reset-after on POST checkout.stripe.com/checkout/:id/complete")
    expect(out).toContain("PASS  duplicate on webhook checkout.session.completed")
    expect(out).toMatch(/faults: \d+ passed\n/)
    expect(code).toBe(0)
  }, 300_000)

  it("catches a shop that grants credits twice for a duplicated webhook", async () => {
    const { code, out } = await danwo(SHOP, ["matrix", "tests/buy-credits.danwo.ts"], {
      SHOP_BUG: "no-dedupe",
    })

    expect(out).toContain("FAIL  duplicate on webhook checkout.session.completed")
    expect(out).toContain("invariant: expected 1000 to be 500")
    expect(out).toContain("faults: 14 passed, 1 failed")
    expect(code).toBe(1)

    // Only the failed run is kept, and the run's report shows why it failed.
    expect(out.match(/record: \.danwo\/runs\//g)).toHaveLength(1)
    const report = /report: (\S+report\.html)/.exec(out)?.[1] ?? ""
    const html = await readFile(join(SHOP, report), "utf8")

    expect(html).toContain("duplicate on webhook checkout.session.completed")
    expect(html).toContain("invariant: expected 1000 to be 500")
    expect(html).toContain("Webhook deliveries")
    expect(html).toMatch(
      /<code>checkout\.session\.completed<\/code>[^]*?<span class="fault">duplicate<\/span>/,
    )
    expect(html).toContain("POST api.stripe.com/v1/checkout/sessions")
    expect(html).not.toMatch(/sk_test_danwo_example|whsec_danwo_example/)
  }, 300_000)

  it("runs on an app with no webhook services, planning outbound faults only", async () => {
    const { code, out } = await danwo(fixture("uploads"), ["matrix", "tests/upload.danwo.ts"])

    expect(out).toContain("PASS  clean run")
    expect(out).toMatch(/clean run passed; \d+ faults planned/)
    expect(out).toContain("PASS  status 503 on PUT danwo-uploads.t3.storage.dev/uploads/report.txt")
    expect(out).toContain(
      "PASS  reset-after on PUT danwo-uploads.t3.storage.dev/uploads/report.txt",
    )
    expect(out).not.toContain("webhook")
    expect(code).toBe(0)
  }, 120_000)

  it("signs in with Google through the emulator and judges token-endpoint faults by the invariant", async () => {
    const { code, out } = await danwo(fixture("signin"), ["matrix", "tests/sign-in.danwo.ts"])

    expect(out).toContain("PASS  clean run")
    expect(out).toContain("PASS  status 500 on POST oauth2.googleapis.com/token")
    expect(out).toContain("PASS  status 400 on POST oauth2.googleapis.com/token")
    expect(out).toContain("PASS  reset-after on POST oauth2.googleapis.com/token")
    // The browser's account chooser on accounts.google.com is never faulted.
    expect(out).not.toContain("accounts.google.com")
    expect(out).toContain("faults: 6 passed")
    expect(code).toBe(0)
  }, 180_000)

  it("reports a run whose fault never fired as invalid", async () => {
    const { code, out } = await danwo(fixture("invariant"), ["matrix", "tests/unfired.danwo.ts"])

    expect(out).toContain("PASS  clean run")
    expect(out).toContain("no invariant: the body must pass under every fault")
    expect(out).toContain("INVALID  duplicate on webhook customer.created")
    expect(out).toContain("the fault never fired")
    expect(out).toContain("faults: 4 invalid (fault never fired)")
    expect(code).toBe(1)
  }, 120_000)
})
