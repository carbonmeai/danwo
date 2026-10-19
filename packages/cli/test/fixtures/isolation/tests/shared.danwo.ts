import { changeEverything, observe, test } from "./state.ts"

/* This file opts its tests into building on one another, whatever the config says. */
test.use({ isolation: "file" })

test("first in shared: changes every kind of state", async (fixtures) => {
  await observe("shared1", fixtures)
  await changeEverything(fixtures)
})

test("second in shared: sees the first test's changes", async (fixtures) => {
  await observe("shared2", fixtures)
})
