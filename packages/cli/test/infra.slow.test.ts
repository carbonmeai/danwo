import { execFile } from "node:child_process"
import { fileURLToPath } from "node:url"

import { Redis } from "ioredis"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { container, dockerAvailable, startPostgres, waitFor } from "../../data/test/containers.ts"
import { rebuild, withDatabase } from "./fixtures/orders-postgres/schema.ts"

const BIN = fileURLToPath(new URL("../bin/danwo.mjs", import.meta.url))
const CHECKOUT = fileURLToPath(new URL("./fixtures/checkout-postgres/", import.meta.url))
const RATE_LIMIT = fileURLToPath(new URL("./fixtures/rate-limit-redis/", import.meta.url))

const CHECKOUT_SCHEMA = `
  CREATE TABLE orders (id serial PRIMARY KEY, checkout_key text UNIQUE, payment_intent text NOT NULL);
  CREATE TABLE stock (item text PRIMARY KEY, left_count integer NOT NULL);
  INSERT INTO stock VALUES ('lamp', 5);
`

/** Runs a fixture's matrix; its exit code and output. */
function matrix(cwd: string, file: string, env: NodeJS.ProcessEnv, args: readonly string[] = []) {
  return new Promise<{ code: number; out: string }>((resolve) => {
    execFile(
      process.execPath,
      [BIN, "matrix", file, "--workers", "2", ...args],
      { cwd, env: { ...process.env, NO_COLOR: "1", ...env }, maxBuffer: 16 * 1024 * 1024 },
      (error, stdout, stderr) => {
        const code = error === null ? 0 : typeof error.code === "number" ? error.code : 1

        resolve({ code, out: `${stdout}${stderr}` })
      },
    )
  })
}

/** Each faulted run's verdict and label, e.g. `FAIL  reset-after on COMMIT (postgres)`. */
function verdicts(out: string): string[] {
  return out
    .split("\n")
    .filter((line) => /^(PASS|FAIL|INVALID|NOT JUDGED)\s/.test(line))
    .map((line) => line.replace(/\s+/, " "))
    .toSorted()
}

/** The labels of the runs that came out `status`. */
function labelled(out: string, status: string): string[] {
  return verdicts(out)
    .filter((line) => line.startsWith(`${status} `))
    .map((line) => line.slice(status.length + 1))
}

describe.skipIf(!dockerAvailable())("danwo matrix faults the app's own Postgres", () => {
  let server: Awaited<ReturnType<typeof startPostgres>>

  beforeAll(async () => {
    server = await startPostgres()
  }, 180_000)

  afterAll(() => server?.stop())

  /**
   * One matrix run of the checkout app with `bug` switched in, on a base database of its own:
   * a run's workers retire their databases by name, so runs do not share one.
   */
  const run = async (bug: string) => {
    const name = `checkout_${bug.replaceAll("-", "_") || "correct"}`

    await rebuild(server.url, name, CHECKOUT_SCHEMA)

    return matrix(
      CHECKOUT,
      "tests/checkout.danwo.ts",
      { DANWO_PG_URL: withDatabase(server.url, name), DANWO_BUG: bug },
      ["--faults", String.raw`\(postgres\)`],
    )
  }

  it("passes every data fault when the app retries and is idempotent around COMMIT", async () => {
    const correct = await run("")

    console.log(`checkout-postgres, correct app:\n${correct.out}`)
    expect(labelled(correct.out, "PASS")).toEqual(
      expect.arrayContaining([
        "reset-after on COMMIT (postgres)",
        "serialization_failure on INSERT orders (postgres)",
        "serialization_failure on COMMIT (postgres)",
        "deadlock_detected on UPDATE stock (postgres)",
        "down 3000ms on BEGIN (postgres)",
        "too_many_connections 3000ms on BEGIN (postgres)",
      ]),
    )
    expect(labelled(correct.out, "FAIL")).toEqual([])
    expect(correct.code).toBe(0)
  }, 300_000)

  it("catches each bug on the fault that exposes it", async () => {
    const blind = await run("blind-insert")
    const noRetry = await run("no-serialization-retry")
    const whole = await run("retry-request")

    console.log(`checkout-postgres, blind-insert:\n${blind.out}`)
    console.log(`checkout-postgres, no-serialization-retry:\n${noRetry.out}`)
    console.log(`checkout-postgres, retry-request:\n${whole.out}`)

    expect(labelled(blind.out, "FAIL")).toEqual(["reset-after on COMMIT (postgres)"])
    expect(labelled(noRetry.out, "FAIL")).toEqual([
      "deadlock_detected on INSERT orders (postgres)",
      "deadlock_detected on UPDATE stock (postgres)",
      "serialization_failure on COMMIT (postgres)",
      "serialization_failure on INSERT orders (postgres)",
      "serialization_failure on UPDATE stock (postgres)",
    ])
    expect(labelled(whole.out, "FAIL")).toContain("reset-after on COMMIT (postgres)")
    expect(labelled(whole.out, "PASS")).toContain("delay 5000ms on INSERT orders (postgres)")

    for (const buggy of [blind, noRetry, whole]) expect(buggy.code).not.toBe(0)
  }, 600_000)
})

describe.skipIf(!dockerAvailable())("danwo matrix faults the app's own Redis", () => {
  let server: Awaited<ReturnType<typeof container>>
  let url: string

  beforeAll(async () => {
    server = await container("redis:7-alpine", 6379)
    url = `redis://127.0.0.1:${server.port}`
    await waitFor(async () => {
      const probe = new Redis(url, { lazyConnect: true, retryStrategy: () => null })

      probe.on("error", () => undefined)

      try {
        await probe.connect()
        await probe.ping()
      } finally {
        probe.disconnect()
      }
    }, "redis")
  }, 180_000)

  afterAll(() => server?.stop())

  it("holds the rate limit under cache faults when it fails closed, and not when it fails open", async () => {
    const closed = await matrix(RATE_LIMIT, "tests/login.danwo.ts", { DANWO_REDIS_URL: url })
    const open = await matrix(RATE_LIMIT, "tests/login.danwo.ts", {
      DANWO_REDIS_URL: url,
      DANWO_BUG: "fail-open",
    })

    console.log(`rate-limit-redis, fails closed:\n${closed.out}`)
    console.log(`rate-limit-redis, fails open:\n${open.out}`)

    expect(labelled(closed.out, "PASS")).toContain("OOM on INCR rate:login:ada (cache)")
    expect(labelled(closed.out, "FAIL")).toEqual([])
    expect(closed.code).toBe(0)
    expect(labelled(open.out, "FAIL")).toEqual(
      expect.arrayContaining([
        "OOM on INCR rate:login:ada (cache)",
        "READONLY on INCR rate:login:ada #3 (cache)",
      ]),
    )
    expect(open.code).not.toBe(0)
  }, 600_000)
})
