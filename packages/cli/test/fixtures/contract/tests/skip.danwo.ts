import { test } from "@danwo/sdk"

import { log } from "./log.ts"

test.skip("is skipped by its declaration", () => {
  log("ran a skipped test")
})

test("is skipped by its options", { skip: "not on this run" }, () => {
  log("ran a skipped test")
})

test("skips itself at runtime", () => {
  test.skip("decided while running")
  log("ran past test.skip")
})
