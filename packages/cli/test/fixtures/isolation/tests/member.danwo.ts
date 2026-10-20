import { changeEverything, observe, test } from "./state.ts"

/* Both tests start signed in as the member: the session's sign-in made one Stripe customer. */
test.use({ session: "member" })

test("first as the member: changes every kind of state", async (fixtures) => {
  await observe("m1", fixtures)
  await changeEverything(fixtures)
})

test("second as the member: starts from the sign-in again", async (fixtures) => {
  await observe("m2", fixtures)
})
