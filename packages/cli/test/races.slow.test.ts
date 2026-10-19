import { execFile } from "node:child_process"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest"

import { removeWorkCopies, workCopy } from "./work-copy.ts"

const BIN = fileURLToPath(new URL("../src/bin.ts", import.meta.url))
const fixture = (name: string) =>
  workCopy(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)))
const SHOP = workCopy(fileURLToPath(new URL("../../../examples/shop", import.meta.url)))

let state: string

beforeEach(async () => {
  state = await mkdtemp(join(tmpdir(), "danwo-races-"))
})

afterEach(async () => {
  await rm(state, { recursive: true, force: true })
})

/** Failing runs leave flight records beside each fixture's config; they are the tests' own. */
afterAll(removeWorkCopies)

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

describe("race faults: the last lamp", () => {
  it("sells the last lamp once, whether Buy is sent twice or two people buy at once", async () => {
    const { code, out } = await danwo(fixture("last-item"), ["matrix", "tests/lamp.danwo.ts"])

    expect(out).toContain("clean run passed; 2 faults planned")
    expect(out).toContain("PASS  double-submit on POST /buy")
    expect(out).toContain("PASS  2 concurrent users")
    expect(out).toContain("user 2: passed")
    expect(out).toContain("faults: 2 passed")
    expect(code).toBe(0)
  }, 300_000)

  it("catches a shop that reads the stock, waits, then writes it", async () => {
    const { code, out } = await danwo(fixture("last-item"), ["matrix", "tests/lamp.danwo.ts"], {
      OVERSELL_BUG: "1",
    })

    expect(out).toContain("FAIL  double-submit on POST /buy")
    expect(out).toContain("FAIL  2 concurrent users")
    expect(out).toContain("invariant: expected 2 to be less than or equal to 1")
    expect(out).toContain("faults: 2 failed")
    expect(code).toBe(1)
  }, 300_000)
})

describe("race faults: order status from webhooks", () => {
  it("keeps an order paid when its webhooks come early or the other way round", async () => {
    const { code, out } = await danwo(fixture("order-status"), [
      "matrix",
      "tests/order.danwo.ts",
      "--faults",
      "double|redirect|reorder|slow",
    ])

    expect(out).toContain("PASS  double-submit on POST /buy")
    expect(out).toMatch(/PASS {2}webhooks before redirect from checkout\.stripe\.com/)
    expect(out).toMatch(/held the return from checkout\.stripe\.com until \d+ webhook deliver/)
    expect(out).toContain("PASS  reorder webhooks payment_intent.created, payment_intent.succeeded")
    expect(out).toContain(
      "PASS  slow-then-retry 3000ms on POST api.stripe.com/v1/checkout/sessions",
    )
    expect(out).toContain("faults: 4 passed")
    expect(code).toBe(0)
  }, 300_000)

  it("catches an app that lets the latest webhook set the status", async () => {
    const { code, out } = await danwo(
      fixture("order-status"),
      ["matrix", "tests/order.danwo.ts", "--faults", "reorder"],
      { ORDER_BUG: "reorder" },
    )

    expect(out).toContain("FAIL  reorder webhooks payment_intent.created, payment_intent.succeeded")
    expect(out).toContain("faults: 1 failed")
    expect(code).toBe(1)
  }, 300_000)
})

describe("race faults: the shop", () => {
  it("survives Pay sent twice, webhooks before the redirect and a slow, retried checkout", async () => {
    const { code, out } = await danwo(SHOP, [
      "matrix",
      "tests/buy-credits.danwo.ts",
      "--faults",
      "double|redirect|slow",
    ])

    expect(out).toContain("PASS  double-submit on POST /buy")
    expect(out).toContain("POST /buy sent twice at once")
    expect(out).toContain("PASS  webhooks before redirect from checkout.stripe.com")
    expect(out).toContain(
      "PASS  slow-then-retry 3000ms on POST api.stripe.com/v1/checkout/sessions",
    )
    expect(out).toContain("faults: 3 passed")
    expect(code).toBe(0)
  }, 300_000)
})
