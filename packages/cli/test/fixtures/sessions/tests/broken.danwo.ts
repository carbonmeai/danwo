import { test } from "@danwo/sdk"

/** A sign-in with the wrong password: the form never lets this session through. */
test.session("intruder", async ({ app, screen, expect }) => {
  await app.open("/login")
  await screen.getByLabel("Email").fill("ada@danwo.test")
  await screen.getByLabel("Password").fill("not-the-password")
  await screen.getByRole("button", { name: "Sign in" }).click()
  await expect(screen.getByRole("heading", { name: /^Notes for/ })).toBeVisible({ timeout: 1_000 })
})

test.describe("as an intruder", () => {
  test.use({ session: "intruder" })

  test("reads the notes", async ({ app }) => {
    await app.open("/notes")
  })

  test("saves a note", async ({ app }) => {
    await app.open("/notes")
  })
})
