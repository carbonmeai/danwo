import { test } from "@danwo/sdk"

import { log } from "./log.ts"

test("fails in its body", ({ expect }) => {
  log("body that fails")
  expect("body").toBe("passing")
}).invariant(() => {
  log("invariant after a failed body")
})
