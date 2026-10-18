import { type ClerkFixtures, test as base } from "@danwo/sdk"

const test = base.extend<ClerkFixtures>()
const EMAIL = "ada@danwo.test"

/* Run with CLERK_SIGN_IN=code, so the instance signs in by emailed code. */
test("signs in with a code Clerk emails", async ({ app, screen, mail, expect }) => {
  await app.open("/")
  await screen.getByLabel("Email address").fill(EMAIL)
  await screen.getByRole("button", { name: "Continue", exact: true }).click()
  await screen.getByLabel("Enter verification code").fill(await mail.code(EMAIL))
  await expect(screen.getByRole("heading", { name: "Signed in" })).toBeVisible()
  await expect(screen.getByRole("status")).toHaveText(EMAIL)
})
