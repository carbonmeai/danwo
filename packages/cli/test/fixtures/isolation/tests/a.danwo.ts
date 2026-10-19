import { changeEverything, observe, test } from "./state.ts"

test("first in a: changes every kind of state", async (fixtures) => {
  await observe("a1", fixtures)
  await changeEverything(fixtures)
})

test("second in a: changes it again", async (fixtures) => {
  await observe("a2", fixtures)
  await changeEverything(fixtures)
})
