import { test } from "@danwo/sdk"

import { log } from "./log.ts"

test("is left out by only", () => {
  log("ran the test left out by only")
})

test.only("is the only one run", () => {
  log("ran the only test")
})
