import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

import type { FaultMatrixResult } from "@danwo/core"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { runMatrix } from "../src/runner/matrix-command.ts"

const FIXTURE = fileURLToPath(new URL("./fixtures/counted-shop/", import.meta.url))
const CONFIG = join(FIXTURE, "danwo.config.ts")
const TEST = fileURLToPath(
  new URL("../../../examples/shop/tests/buy-credits.danwo.ts", import.meta.url),
)

let countFile: string
let dir: string
const saved = { bug: process.env.SHOP_BUG, count: process.env.DANWO_COUNT_FILE }

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "danwo-speed-"))
  countFile = join(dir, "calls.txt")
  process.env.DANWO_COUNT_FILE = countFile
})

afterEach(async () => {
  for (const [key, value] of [
    ["SHOP_BUG", saved.bug],
    ["DANWO_COUNT_FILE", saved.count],
  ] as const) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }

  await rm(dir, { recursive: true, force: true })
})

/** Runs the counted shop's matrix; its result and every line it printed. */
async function matrix(options: { workers: number; shuffle?: number; maxFailures?: number }) {
  const lines: string[] = []
  const { result, code } = await runMatrix({
    cwd: FIXTURE,
    config: CONFIG,
    file: TEST,
    record: "off",
    write: (line) => lines.push(line),
    ...options,
  })

  return { result, code, out: lines.join("\n") }
}

/** Each faulted trial's verdict, by its fault's label. */
function verdicts(result: FaultMatrixResult): Record<string, string> {
  return Object.fromEntries(result.runs.map((run) => [run.fault?.label ?? "clean", run.status]))
}

/** How often each environment call happened, from the count file. */
async function calls(): Promise<Record<string, number>> {
  const lines = (await readFile(countFile, "utf8")).trim().split("\n")
  const counts: Record<string, number> = {}

  for (const line of lines) {
    const call = line.split(" ")[0] ?? ""

    counts[call] = (counts[call] ?? 0) + 1
  }

  return counts
}

describe("danwo matrix speed", () => {
  it("gives the same verdicts whatever order its trials run in", async () => {
    process.env.SHOP_BUG = "no-dedupe"

    const ordered = await matrix({ workers: 3 })
    const shuffled = await matrix({ workers: 3, shuffle: 7 })

    expect(shuffled.out).toContain("trials in shuffled order (seed 7)")
    expect(verdicts(shuffled.result)).toEqual(verdicts(ordered.result))
    expect(verdicts(ordered.result)["duplicate on webhook checkout.session.completed"]).toBe(
      "failed",
    )
    expect(Object.values(verdicts(ordered.result)).filter((v) => v === "failed")).toHaveLength(1)
  }, 300_000)

  it("resets each worker once, snapshots it, and restores it before every later trial", async () => {
    const { result, out } = await matrix({ workers: 2 })
    const counts = await calls()
    const trials = result.runs.length + 1

    expect(out).toMatch(/faults: \d+ passed\n/)
    expect(counts.reset).toBeGreaterThanOrEqual(1)
    expect(counts.reset).toBeLessThanOrEqual(2)
    expect(counts.snapshot).toBe(counts.reset)
    expect((counts.reset ?? 0) + (counts.restore ?? 0)).toBe(trials)
    expect(out).toMatch(/trial time \(median of \d+\): \d+ ms · prepare \d+ ms/)
  }, 300_000)

  it("starts no new trial once --max-failures trials failed", async () => {
    process.env.SHOP_BUG = "no-dedupe"

    const { result, out, code } = await matrix({ workers: 1, maxFailures: 1 })
    const failed = result.runs.filter((run) => run.status === "failed")

    expect(failed).toHaveLength(1)
    expect(out).toMatch(/stopped after 1 failed: \d+ planned faults not run/)
    expect(result.runs.length).toBeLessThan(15)
    expect(code).toBe(1)
  }, 300_000)
})
