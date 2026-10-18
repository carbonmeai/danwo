import { execFile } from "node:child_process"
import { fileURLToPath } from "node:url"

import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { dockerAvailable, startPostgres } from "../../data/test/containers.ts"
import { rebuild, withDatabase } from "./fixtures/orders-postgres/schema.ts"

const BIN = fileURLToPath(new URL("../bin/danwo.mjs", import.meta.url))
const ORDERS = fileURLToPath(new URL("./fixtures/orders-postgres/", import.meta.url))

/** Runs the orders fixture's matrix; its exit code and output. */
function matrix(env: NodeJS.ProcessEnv, args: readonly string[] = []) {
  return new Promise<{ code: number; out: string }>((resolve) => {
    execFile(
      process.execPath,
      [BIN, "matrix", "tests/order.danwo.ts", ...args],
      { cwd: ORDERS, env: { ...process.env, NO_COLOR: "1", ...env } },
      (error, stdout, stderr) => {
        const code = error === null ? 0 : typeof error.code === "number" ? error.code : 1

        resolve({ code, out: `${stdout}${stderr}` })
      },
    )
  })
}

/** The verdict lines of a matrix report, e.g. `PASS  status 500 on POST …`. */
function verdicts(out: string): string[] {
  return out
    .split("\n")
    .filter((line) => /^(PASS|FAIL|INVALID|NOT JUDGED)\s/.test(line))
    .toSorted()
}

/** The median `prepare` phase from a matrix run's timing line. */
function preparedIn(out: string): number {
  return Number(/prepare (\d+) ms/.exec(out)?.[1] ?? Number.NaN)
}

describe.skipIf(!dockerAvailable())("danwo matrix on an app backed by Postgres", () => {
  let server: Awaited<ReturnType<typeof startPostgres>>
  let url: string

  beforeAll(async () => {
    server = await startPostgres()
    url = server.url
    await rebuild(url, "orders_base")
  }, 180_000)

  afterAll(() => server.stop())

  it("runs danwo matrix on two workers, isolated in any order, and restores faster than a rebuild", async () => {
    const env = { DANWO_PG_URL: withDatabase(url, "orders_base") }
    const ordered = await matrix(env, ["--workers", "2"])
    const shuffled = await matrix(env, ["--workers", "2", "--shuffle", "7"])
    const swapped = await matrix({ ...env, DANWO_PG_STRATEGY: "swap" }, ["--workers", "2"])
    const rebuilt = await matrix({ ...env, DANWO_PG_MODE: "rebuild" }, ["--workers", "2"])

    for (const run of [ordered, shuffled, swapped, rebuilt]) {
      expect(run.out).toMatch(/faults: \d+ passed\n/)
      expect(run.code).toBe(0)
    }

    expect(verdicts(shuffled.out)).toEqual(verdicts(ordered.out))
    expect(verdicts(ordered.out).length).toBeGreaterThan(3)
    console.log(
      `matrix prepare median: recreate ${preparedIn(ordered.out)} ms, swap ${preparedIn(swapped.out)} ms, rebuild ${preparedIn(rebuilt.out)} ms`,
    )
    expect(preparedIn(ordered.out)).toBeLessThan(preparedIn(rebuilt.out))
  }, 300_000)
})
