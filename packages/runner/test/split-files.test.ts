import { describe, expect, it } from "vitest"

import type { CatalogEntry } from "../src/runner/catalog.ts"
import { tasksOf } from "../src/runner/test-command.ts"

const TASK = { retries: 0, cacheDir: undefined }

/** A test of `file`, standalone unless it shares setup or state with its file. */
function entry(file: string, title: string, standalone = true): CatalogEntry {
  return {
    id: `${file} › ${title}`,
    file,
    mode: "normal",
    invariant: false,
    ...(standalone && { standalone: true }),
  }
}

const ENTRIES = [
  entry("slow.danwo.ts", "one"),
  entry("slow.danwo.ts", "two"),
  entry("shared.danwo.ts", "signs up"),
  entry("shared.danwo.ts", "then pays", false),
]

describe("handing workers their tasks", () => {
  it("gives a worker one whole file at a time by default", () => {
    expect(tasksOf(ENTRIES, TASK).map((task) => task.testIds)).toEqual([
      ["slow.danwo.ts › one", "slow.danwo.ts › two"],
      ["shared.danwo.ts › signs up", "shared.danwo.ts › then pays"],
    ])
  })

  it("splits a file whose tests share nothing into single tests, and keeps the others whole", () => {
    expect(tasksOf(ENTRIES, TASK, true).map((task) => [task.file, task.testIds])).toEqual([
      ["slow.danwo.ts", ["slow.danwo.ts › one"]],
      ["slow.danwo.ts", ["slow.danwo.ts › two"]],
      ["shared.danwo.ts", ["shared.danwo.ts › signs up", "shared.danwo.ts › then pays"]],
    ])
  })
})
