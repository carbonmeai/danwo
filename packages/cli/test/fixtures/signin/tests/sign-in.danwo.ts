import { type GoogleFixtures, googleSignIns, test as base } from "@danwo/sdk"

const test = base.extend<GoogleFixtures>()

test("signs in with Google", async ({ app, screen, expect }) => {
  await app.open("/")
  await screen.getByRole("link", { name: "Sign in with Google" }).click()
  await screen.getByRole("button", { name: "Continue as Ada Lovelace" }).click()

  await expect(screen.getByRole("heading", { name: "Signed in as ada@danwo.test" })).toBeVisible()
}).invariant(async ({ app, google, expect }) => {
  /*
   * Whichever way sign-in went, every session the app holds is Ada's and came from a code Google
   * actually exchanged: no session without a token, none for anyone else.
   */
  const res = await fetch(`${app.baseUrl}/sessions`)
  const { sessions } = (await res.json()) as { sessions: string[] }
  const exchanged = googleSignIns(google)
    .list("123-danwo.apps.googleusercontent.com")
    .filter((signIn) => signIn.redeemed && signIn.accessTokens > 0)

  expect(sessions.every((email) => email === "ada@danwo.test")).toBe(true)
  expect(sessions.length <= exchanged.length).toBe(true)
})
