import { test } from "@danwo/sdk"

/** Credentials the app refuses: the sign-in form never lets this session through. */
const refused = { Email: "ada@danwo.test", Password: "not-the-password" }

test.session("intruder", async ({ app, screen, expect }) => {
  await app.open("/login")
  for (const [label, value] of Object.entries(refused)) await screen.getByLabel(label).fill(value)

  await screen.getByRole("button", { name: "Sign in" }).click()
  await expect(screen.getByRole("heading", { name: /^Notes for/ })).toBeVisible({ timeout: 1_000 })
})

test.describe("as an intruder", () => {
  test.use({ session: "intruder" })

  for (const name of ["reads the notes", "saves a note"])
    test(name, async ({ app }) => {
      await app.open("/notes")
    })
})
