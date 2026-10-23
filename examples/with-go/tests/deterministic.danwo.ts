import { resendInbox, test as base } from "@danwo/sdk"

import {
  DECLINED_CARD,
  expectPlansMatchStripe,
  pay,
  type QuillworkFixtures,
  signUp,
} from "./quillwork.ts"

const test = base.extend<QuillworkFixtures>()

test("asks for a valid email and a team name", async ({ app, screen, expect }) => {
  await app.open("/")
  await expect(
    screen.getByRole("heading", { name: "Notes your whole team can find" }),
  ).toBeVisible()
  await expect(screen.getByRole("region", { name: "Team", exact: true })).toContainText("$24")

  await screen.getByLabel("Work email").fill("not-an-email")
  await screen.getByRole("button", { name: "Create account" }).click()

  await expect(screen.getByText("Enter a valid email address.")).toBeVisible()
  await expect(screen.getByText("Give your team a name.")).toBeVisible()
  await expect(screen.getByLabel("Work email")).toHaveAttribute("aria-invalid", "true")
}).invariant(async ({ sql, expect }) => {
  expect(await sql("select id from accounts")).toHaveLength(0)
})

test("signs up on the Free plan", async ({ app, screen, expect }) => {
  await signUp({ app, screen, expect }, { email: "grace@quillwork.test", team: "Hopper" })

  await expect(screen.getByText("Signed in as grace@quillwork.test")).toBeVisible()
  await expect(screen.getByTestId("plan-name")).toHaveText("Free")
  await expect(screen.getByRole("button", { name: "Upgrade to Team" })).toBeVisible()
}).invariant(async (fixtures) => {
  // A free team owes Stripe nothing and gets no welcome email.
  await expectPlansMatchStripe(fixtures)
  fixtures.expect(await fixtures.sql("select id from subscriptions")).toHaveLength(0)
})

test("upgrades to the Team plan through Stripe Checkout", async ({ app, screen, expect }) => {
  await pay({ app, screen, expect }, { email: "sam@quillwork.test", team: "Northwind" })

  await expect(screen.getByTestId("plan-name")).toHaveText("Team")
  await expect(screen.getByTestId("plan-status")).toHaveText("Active")
  await expect(screen.getByRole("button", { name: "Upgrade to Team" })).toBeHidden()
}).invariant(async (fixtures) => {
  await expectPlansMatchStripe(fixtures)
})

test("a declined card shows Stripe's error and starts no plan", async ({ app, screen, expect }) => {
  await pay(
    { app, screen, expect },
    { email: "kit@quillwork.test", team: "Kestrel", card: DECLINED_CARD },
  )

  await expect(screen.getByRole("alert")).toHaveText("Your card was declined.")

  await app.open("/account")
  await expect(screen.getByTestId("plan-name")).toHaveText("Free")
}).invariant(async (fixtures) => {
  await expectPlansMatchStripe(fixtures)
  fixtures.expect(await fixtures.sql("select id from subscriptions")).toHaveLength(0)
  fixtures.expect(resendInbox(fixtures.resend).list("kit@quillwork.test")).toHaveLength(0)
})
