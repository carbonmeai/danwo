import { type ClerkFixtures, test as base } from "@danwo/sdk"

import { EMAIL, enterEmail } from "./steps.ts"

const test = base.extend<ClerkFixtures>()

/* Run with CLERK_SIGN_IN=code, so the instance signs in by emailed code. */
test("signs in with a code Clerk emails", async ({ app, screen, mail, expect }) => {
  await enterEmail(app, screen)
  await screen.getByLabel("Enter verification code").fill(await mail.code(EMAIL))
  await expect(screen.getByRole("heading", { name: "Signed in" })).toBeVisible()
  await expect(screen.getByRole("status")).toHaveText(EMAIL)
})
