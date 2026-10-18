import type { App, Screen } from "@danwo/sdk"

/** The test user, seeded by the config. */
export const EMAIL = "ada@danwo.test"

/** Opens the app and gives Clerk's <SignIn/> the test user's email address. */
export async function enterEmail(app: App, screen: Screen): Promise<void> {
  await app.open("/")
  await screen.getByLabel("Email address").fill(EMAIL)
  await screen.getByRole("button", { name: "Continue", exact: true }).click()
}
