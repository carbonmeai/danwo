import { describe, expect, it } from "vitest"

import { fileFailure, withTeardown } from "../src/runner/suite-hooks.ts"
import type { FileDeclarations } from "../src/tests/registry.ts"

/** A file whose `afterAll` hooks are `fns`, in the order they run. */
function fileWith(fns: readonly (() => unknown)[]): FileDeclarations {
  return {
    tests: [],
    hooks: fns.map((fn) => ({ kind: "afterAll" as const, block: undefined, fn: async () => fn() })),
    uses: [],
    sessions: new Map(),
    focusLines: [],
    sealed: true,
  }
}

const boom = (message: string) => () => {
  throw new Error(message)
}

describe("afterAll", () => {
  it("runs after the file's tests and passes their result through", async () => {
    const ran: string[] = []
    const file = fileWith([() => ran.push("teardown")])

    await expect(withTeardown(file, {}, async () => "reports")).resolves.toBe("reports")
    expect(ran).toEqual(["teardown"])
  })

  it("runs every hook after a beforeAll threw, and reports the beforeAll's error itself", async () => {
    const ran: string[] = []
    const setup = new Error("seeding failed")
    const file = fileWith([() => ran.push("inner"), () => ran.push("outer")])

    await expect(
      withTeardown(file, {}, async () => {
        throw setup
      }),
    ).rejects.toBe(setup)
    expect(ran).toEqual(["inner", "outer"])
  })

  it("runs the rest after one throws, and names every failure", async () => {
    const ran: string[] = []
    const file = fileWith([boom("bucket gone"), () => ran.push("still runs"), boom("db gone")])
    const error: unknown = await withTeardown(file, {}, async () => "ok").catch((e: unknown) => e)

    expect(ran).toEqual(["still runs"])
    expect(error).toBeInstanceOf(AggregateError)
    expect(String(Reflect.get(Object(error), "message"))).toBe(
      "2 afterAll hooks failed: bucket gone; db gone",
    )
  })

  it("names a teardown failure beside a setup failure", async () => {
    const file = fileWith([boom("cleanup failed")])
    const error: unknown = await withTeardown(file, {}, async () => {
      throw new Error("seeding failed")
    }).catch((e: unknown) => e)

    expect(String(Reflect.get(Object(error), "message"))).toBe(
      "seeding failed (afterAll also failed: cleanup failed)",
    )
  })

  it("reports a lone teardown failure as it is", () => {
    const only = new Error("cleanup failed")

    expect(fileFailure(undefined, [only])).toBe(only)
    expect(fileFailure(undefined, [])).toBeUndefined()
  })
})
