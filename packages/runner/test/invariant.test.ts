import { describe, expect, it } from "vitest"

import { test } from "../src/tests/api.ts"
import { declarationsOf } from "../src/tests/registry.ts"

/** An invariant that holds. */
function invariant(): undefined {
  return undefined
}

describe("test(...).invariant()", () => {
  it("registers the invariant on its test", async () => {
    const declared = await declarationsOf(async () => {
      test("with", () => undefined).invariant(invariant)
      test("without", () => undefined)
    })

    expect(declared.tests.map((t) => [t.title, t.invariant])).toEqual([
      ["with", invariant],
      ["without", undefined],
    ])
  })

  it("refuses a second invariant, and one added after the file loaded", async () => {
    await expect(
      declarationsOf(async () => {
        test("twice", () => undefined)
          .invariant(() => undefined)
          .invariant(() => undefined)
      }),
    ).rejects.toThrow(/already has an invariant/)

    let late: ReturnType<typeof test> | undefined

    await declarationsOf(async () => {
      late = test("late", () => undefined)
    })
    expect(() => late?.invariant(() => undefined)).toThrow(/once its file has loaded/)
  })
})
