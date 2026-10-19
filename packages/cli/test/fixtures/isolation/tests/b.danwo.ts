import { changeEverything, observe, test } from "./state.ts"

test("only in b: changes every kind of state", async (fixtures) => {
  await observe("b1", fixtures)
  await changeEverything(fixtures)
})
