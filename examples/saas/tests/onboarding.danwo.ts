/**
 * Signing up and onboarding: Clerk's sign-up by emailed code, then one form that makes the
 * workspace, its Clerk organization, a Stripe customer and a trialing subscription.
 */
import { resendInbox, test as base } from "@danwo/sdk"

import {
  ADA,
  expectOnboardedOnce,
  expectStatusMatchesStripe,
  expectWelcomedOnce,
  onboard,
  type RelayFixtures,
  signUp,
  WORKSPACE,
} from "./relay.ts"

const test = base.extend<RelayFixtures>()

test("signs up and starts a trial", async ({ app, screen, expect, mail, resend, settle }) => {
  await signUp({ app, screen, expect, mail }, ADA)

  await expect(
    screen.getByRole("heading", { name: "Welcome to Relay. Set up your workspace" }),
  ).toBeVisible()
  await onboard({ app, screen, expect, mail }, WORKSPACE)

  await expect(
    screen.getByRole("button", { name: `Workspace: ${WORKSPACE}. Switch workspace` }),
  ).toBeVisible()
  await expect(screen.getByText("No notes yet")).toBeVisible()

  /* The emails are background jobs: let them finish before reading the inbox. */
  await settle()

  const subjects = resendInbox(resend)
    .list(ADA.email)
    .map((email) => email.subject)

  expect(subjects).toContain("Welcome to Relay")
  expect(subjects).toContain(`${WORKSPACE} is ready: your trial has started`)
}).invariant(async (fixtures) => {
  await expectOnboardedOnce(fixtures)
  await expectStatusMatchesStripe(fixtures)
  await expectWelcomedOnce(fixtures)

  const [workspace] = await fixtures.sql<{ status: string; trial_days: number }>(
    "select subscription_status as status, round(extract(epoch from trial_ends_at - created_at) / 86400)::int as trial_days from workspaces",
  )

  if (workspace) fixtures.expect(workspace).toEqual({ status: "trialing", trial_days: 14 })
})

test(
  "makes a second workspace from the switcher",
  { session: "owner-in-workspace" },
  async ({ app, screen, expect, mail }) => {
    await app.open("/")
    await screen.getByRole("button", { name: /Switch workspace/ }).click()
    await screen.getByRole("link", { name: "+ New workspace" }).click()
    await onboard({ app, screen, expect, mail }, "Acme Labs")

    await screen.getByRole("button", { name: /Switch workspace/ }).click()
    const listed = screen.getByRole("list", { name: "Your workspaces" }).getByRole("link")

    await expect(listed.first()).toHaveText(WORKSPACE)
    await expect(listed.last()).toHaveText("Acme Labs")
    await expect(listed).toHaveCount(2)
  },
).invariant(async (fixtures) => {
  await expectOnboardedOnce(fixtures)
  fixtures.expect(await fixtures.sql("select id from workspaces")).toHaveLength(2)
})
