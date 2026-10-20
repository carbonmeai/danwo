import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, beforeEach, describe, expect, it } from "vitest"

import type { DanwoConfig, LoadedConfig } from "../src/runner/config.ts"
import { keepRunsOf, openRecording, recordOptions } from "../src/runner/recording.ts"
import { DEFAULT_KEEP_RUNS, pruneRuns } from "../src/runner/report.ts"

let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "danwo-retention-"))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

const loaded = (config: DanwoConfig): LoadedConfig => ({ config, path: undefined, root })

describe("how many runs keep their recordings", () => {
  it("defaults to 50, and reads the config's record.keepRuns or the option", () => {
    expect(DEFAULT_KEEP_RUNS).toBe(50)
    expect(keepRunsOf(loaded({}))).toBe(50)
    expect(keepRunsOf(loaded({ record: { keepRuns: 120 } }))).toBe(120)
    expect(keepRunsOf(loaded({ record: { keepRuns: 120 } }), 5)).toBe(5)
    expect(keepRunsOf(loaded({ record: "on-failure" }))).toBe(50)
  })

  it("takes the record mode from either form of the config", () => {
    expect(recordOptions("on-failure")).toEqual({ mode: "on-failure" })
    expect(recordOptions({ mode: "off", keepRuns: 3 })).toEqual({ mode: "off", keepRuns: 3 })
    expect(openRecording(loaded({ record: { mode: "off" } }), undefined)).toBeUndefined()
    expect(openRecording(loaded({ record: { keepRuns: 7 } }), undefined)).toMatchObject({
      mode: "always",
      keepRuns: 7,
    })
  })

  it("prunes all but the newest runs, and never the run just finished", async () => {
    const runs = join(root, "runs")
    const names = ["20261020-090000-aaaa", "20261020-100000-bbbb", "20261020-110000-cccc"]

    for (const name of names) await mkdir(join(runs, name), { recursive: true })

    await pruneRuns(runs, 2)
    expect((await readdir(runs)).toSorted()).toEqual(names.slice(1))

    await pruneRuns(runs, 0)
    expect(await readdir(runs)).toEqual([names[2]])
  })
})
