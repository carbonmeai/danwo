/*
 * Isolation, seen from outside: tests change Stripe, Resend, Composio, the clock and (with
 * Docker) a Postgres table, and write down what they found when they started. Under the default,
 * every test starts from the seeded state; a file that asks for `file` builds on itself; `none`
 * carries everything from file to file.
 */
import { execFile } from "node:child_process"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { z } from "zod"

import { dockerAvailable, startPostgres } from "../../data/test/containers.ts"
import { rebuild, withDatabase } from "./fixtures/orders-postgres/schema.ts"
import { removeWorkCopies, workCopy } from "./work-copy.ts"

const BIN = fileURLToPath(new URL("../bin/danwo.mjs", import.meta.url))
const FIXTURE = workCopy(fileURLToPath(new URL("./fixtures/isolation", import.meta.url)))

const Observed = z.object({
  test: z.string(),
  customers: z.number(),
  emails: z.number(),
  authConfigs: z.number(),
  clockOffset: z.number(),
  orders: z.number(),
})

type Observed = z.infer<typeof Observed>

const MONTH = 30 * 24 * 60 * 60 * 1000

afterAll(removeWorkCopies)

/** Runs `danwo test` on `files` in the fixture; the exit code, output and what each test found. */
async function run(
  files: readonly string[],
  env: NodeJS.ProcessEnv = {},
): Promise<{ code: number; out: string; found: Record<string, Observed>; setups: number }> {
  const state = await mkdtemp(join(tmpdir(), "danwo-isolation-"))

  try {
    const { code, out } = await new Promise<{ code: number; out: string }>((resolve) => {
      execFile(
        process.execPath,
        [BIN, "test", ...files.map((file) => `tests/${file}`), "--record", "off"],
        {
          cwd: FIXTURE,
          env: { ...process.env, NO_COLOR: "1", DANWO_FIXTURE_STATE: state, ...env },
        },
        (error, stdout, stderr) => {
          resolve({
            code: error === null ? 0 : typeof error.code === "number" ? error.code : 1,
            out: `${stdout}${stderr}`,
          })
        },
      )
    })
    const lines = (await readFile(join(state, "observed.jsonl"), "utf8").catch(() => ""))
      .split("\n")
      .filter(Boolean)
    const found = Object.fromEntries(
      lines.map((line) => Observed.parse(JSON.parse(line))).map((seen) => [seen.test, seen]),
    )
    const setups = (await readFile(join(state, "setups.jsonl"), "utf8").catch(() => ""))
      .split("\n")
      .filter(Boolean).length

    return { code, out, found, setups }
  } finally {
    await rm(state, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
}

/** `found[name]` without its name, for comparing with an expected state. */
function stateOf(found: Record<string, Observed>, name: string) {
  const seen = found[name]

  if (seen === undefined) throw new Error(`test ${name} wrote nothing: ${JSON.stringify(found)}`)

  const { test: _name, ...state } = seen

  return state
}

/**
 * The seeded state: what the run's first test found, with the clock where it started and no
 * orders. `after(times, orders)` is that state after the fixture's change ran `times` times.
 */
function seededIn(found: Record<string, Observed>) {
  const seeded = stateOf(found, "a1")

  expect(seeded).toMatchObject({ clockOffset: 0, orders: 0 })

  return {
    seeded,
    after: (times: number, orders = 0) => ({
      customers: seeded.customers + times,
      emails: seeded.emails + times,
      authConfigs: seeded.authConfigs + times,
      clockOffset: times * MONTH,
      orders,
    }),
  }
}

describe("isolation between tests", () => {
  it("starts every test from the seeded state by default, and a file of shared tests builds on itself", async () => {
    const { code, out, found } = await run(["a.danwo.ts", "b.danwo.ts", "shared.danwo.ts"])
    const { seeded, after } = seededIn(found)

    expect(code, out).toBe(0)
    expect(stateOf(found, "a2")).toEqual(seeded)
    expect(stateOf(found, "b1")).toEqual(seeded)
    expect(stateOf(found, "shared1")).toEqual(seeded)
    expect(stateOf(found, "shared2")).toEqual(after(1))
  }, 180_000)

  it("resets once per file under file isolation", async () => {
    const { code, out, found } = await run(["a.danwo.ts", "b.danwo.ts"], {
      FIXTURE_ISOLATION: "file",
    })
    const { seeded, after } = seededIn(found)

    expect(code, out).toBe(0)
    expect(stateOf(found, "a2")).toEqual(after(1))
    expect(stateOf(found, "b1")).toEqual(seeded)
  }, 180_000)

  it("carries state from file to file under none", async () => {
    const { code, out, found } = await run(["a.danwo.ts", "b.danwo.ts"], {
      FIXTURE_ISOLATION: "none",
    })
    const { after } = seededIn(found)

    expect(code, out).toBe(0)
    expect(stateOf(found, "a2")).toEqual(after(1))
    expect(stateOf(found, "b1")).toEqual(after(2))
  }, 180_000)
})

/** What every test found: the member's tests start signed in (one customer more), the others not. */
function expectSignedInOnlyAsMember(found: Record<string, Observed>) {
  const { seeded } = seededIn(found)
  const signedIn = { ...seeded, customers: seeded.customers + 1 }

  expect(stateOf(found, "a2")).toEqual(seeded)
  expect(stateOf(found, "b1")).toEqual(seeded)
  expect(stateOf(found, "m1")).toEqual(signedIn)
  expect(stateOf(found, "m2")).toEqual(signedIn)
}

describe("isolation with a saved session", () => {
  for (const files of [
    ["member.danwo.ts", "a.danwo.ts", "b.danwo.ts"],
    ["a.danwo.ts", "member.danwo.ts", "b.danwo.ts"],
  ]) {
    it(`starts signed-out tests signed out after a signed-in file, in either order (${files.join(", ")})`, async () => {
      const { code, out, found, setups } = await run(files)

      expect(code, out).toBe(0)
      expectSignedInOnlyAsMember(found)
      // The member's sign-in is kept in a slot of its own and restored for its second test.
      expect(setups).toBe(1)
    }, 180_000)
  }

  it("signs the member in again for each test when the environment keeps a single snapshot", async () => {
    const { code, out, found, setups } = await run(
      ["member.danwo.ts", "a.danwo.ts", "b.danwo.ts"],
      { FIXTURE_ONE_SLOT: "1" },
    )

    expect(code, out).toBe(0)
    expectSignedInOnlyAsMember(found)
    expect(setups).toBe(2)
  }, 180_000)
})

describe.skipIf(!dockerAvailable())("isolation with the app's own database", () => {
  let server: Awaited<ReturnType<typeof startPostgres>>
  let url: string

  beforeAll(async () => {
    server = await startPostgres()
    url = server.url
    await rebuild(url, "isolation_base")
  }, 180_000)

  afterAll(() => server.stop())

  it("restores the database before every test as well", async () => {
    const env = { DANWO_PG_URL: withDatabase(url, "isolation_base") }
    const { code, out, found } = await run(["a.danwo.ts", "b.danwo.ts", "shared.danwo.ts"], env)
    const { seeded, after } = seededIn(found)

    expect(code, out).toBe(0)
    expect(stateOf(found, "a2")).toEqual(seeded)
    expect(stateOf(found, "b1")).toEqual(seeded)
    expect(stateOf(found, "shared2")).toEqual(after(1, 1))
  }, 240_000)
})
