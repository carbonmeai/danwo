import { afterAll, afterEach, beforeAll, beforeEach, describe, test as base } from "@danwo/sdk"

import { log } from "./log.ts"

const test = base.extend<{ resource: string }>({
  resource: async (_fixtures, use) => {
    log("fixture setup")
    await use("ready")
    log("fixture teardown")
  },
})

beforeAll(() => log("beforeAll"))
afterAll(() => log("afterAll"))

describe("outer", () => {
  beforeEach(() => log("beforeEach outer"))
  afterEach(() => log("afterEach outer"))

  describe("inner", () => {
    beforeEach(() => log("beforeEach inner"))
    afterEach(() => log("afterEach inner"))

    test("uses a fixture", ({ resource }) => {
      log(`body uses a fixture: ${resource}`)
    }).invariant(({ resource }) => {
      log(`invariant: ${resource}`)
    })

    test("runs second", () => {
      log("body runs second")
    })
  })
})
