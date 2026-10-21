/**
 * Billing: a card added on Stripe's page, the trial running out (time travel moves Relay, Stripe
 * and the browser a fortnight on), the first invoice paid or declined, and changing plan.
 */
import { resendInbox, test as base, z } from "@danwo/sdk"

import {
  ADA,
  addCard,
  expectBilledOnce,
  expectStatusMatchesStripe,
  openSection,
  type RelayFixtures,
  signIn,
} from "./relay.ts"

const test = base.extend<RelayFixtures>()

/** Stripe's card that saves fine but declines every charge. */
const DECLINES_ON_CHARGE = "4000 0000 0000 0341"

type Steps = Parameters<typeof openSection>[0]

const Invoices = z.object({ data: z.array(z.object({ amount_paid: z.number() })) })

/** Opens the billing tab of the workspace's settings. */
async function openBilling(steps: Steps): Promise<void> {
  await openSection(steps, "Settings")
  await steps.screen.getByRole("link", { name: "Billing" }).click()
  await steps.expect(steps.screen.getByTestId("billing-plan")).toBeVisible()
}

/** The emails Ada got with `subject` starting so. */
function mailTo(fixtures: RelayFixtures, subject: string) {
  return resendInbox(fixtures.resend)
    .list(ADA.email)
    .filter((email) => email.subject.startsWith(subject))
}

test(
  "the trial ends and the first invoice is paid",
  { session: "owner-in-workspace" },
  async ({ app, screen, expect, mail, time, resend }) => {
    const steps = { app, screen, expect, mail }

    await app.open("/")
    await openBilling(steps)
    await expect(screen.getByTestId("billing-status")).toHaveText("Trial")
    await addCard(steps)
    await expect(screen.getByTestId("billing-card")).toHaveText("Visa ending 4242")

    /* Day 11: Stripe says the trial ends in three days, and Relay reminds Ada. */
    await time.travel({ days: 11, hours: 1 })
    expect(
      resendInbox(resend)
        .list(ADA.email)
        .map((email) => email.subject),
    ).toContain("Your Relay trial ends in 3 days")

    /* Day 15: the trial is over and the first invoice paid. Ada's session expired meanwhile. */
    await time.travel({ days: 4 })
    await signIn(steps, ADA)
    await openBilling(steps)
    await expect(screen.getByTestId("billing-status")).toHaveText("Active")
    await expect(screen.getByRole("table", { name: "Invoices" }).getByText("$29")).toBeVisible()
    await expect(screen.getByTestId("trial-banner")).toBeHidden()
  },
).invariant(async (fixtures) => {
  await expectStatusMatchesStripe(fixtures)
  await expectBilledOnce(fixtures)

  /* However far the run got: a reminder once the trial was over, and a receipt per paid invoice. */
  const [workspace] = await fixtures.sql<{ status: string }>(
    "select subscription_status as status from workspaces",
  )
  const answer = await fixtures.stripe.fetch(
    new Request("https://api.stripe.com/v1/invoices?status=paid", {
      headers: { authorization: "Bearer sk_test_relay_notes" },
    }),
  )
  const paid = Invoices.parse(await answer.json()).data.filter((invoice) => invoice.amount_paid > 0)
  const reminders = mailTo(fixtures, "Your Relay trial ends")

  if (workspace?.status === "trialing")
    fixtures.expect(reminders.length, "at most one trial reminder").toBeLessThanOrEqual(1)
  else fixtures.expect(reminders, "one trial reminder").toHaveLength(1)
  fixtures
    .expect(mailTo(fixtures, "Receipt for Acme"), "one receipt per paid invoice")
    .toHaveLength(paid.length)
})

test(
  "a declined renewal marks the workspace past due",
  { session: "owner-in-workspace" },
  async ({ app, screen, expect, mail, time }) => {
    const steps = { app, screen, expect, mail }

    await app.open("/")
    await openBilling(steps)
    await addCard(steps, DECLINES_ON_CHARGE)
    await expect(screen.getByTestId("billing-card")).toHaveText("Visa ending 0341")

    await time.travel({ days: 15 })
    await signIn(steps, ADA)

    await expect(screen.getByRole("alert")).toContainText("Payment failed.")
    await openBilling(steps)
    await expect(screen.getByTestId("billing-status")).toHaveText("Past due")
  },
).invariant(async (fixtures) => {
  await expectStatusMatchesStripe(fixtures)

  const [workspace] = await fixtures.sql<{ status: string }>(
    "select subscription_status as status from workspaces",
  )

  /* Past due means exactly one "we couldn't take payment"; still trialing, none yet. */
  fixtures
    .expect(mailTo(fixtures, "We couldn't take payment"), "one payment-failed email when past due")
    .toHaveLength(workspace?.status === "past_due" ? 1 : 0)
})

const Subscriptions = z.object({
  data: z.array(
    z.object({
      items: z.object({ data: z.array(z.object({ price: z.object({ id: z.string() }) })) }),
    }),
  ),
})

test(
  "upgrades to the Business plan",
  { session: "owner-in-workspace" },
  async ({ app, screen, expect, mail }) => {
    await app.open("/")
    await openBilling({ app, screen, expect, mail })
    await screen.getByRole("button", { name: "Upgrade to Business" }).click()

    await expect(screen.getByRole("status")).toHaveText("You're on the Business plan.")
    await expect(screen.getByTestId("billing-plan")).toHaveText("Business")
  },
).invariant(async (fixtures) => {
  await expectStatusMatchesStripe(fixtures)

  const answer = await fixtures.stripe.fetch(
    new Request("https://api.stripe.com/v1/subscriptions", {
      headers: { authorization: "Bearer sk_test_relay_notes" },
    }),
  )
  const prices = Subscriptions.parse(await answer.json()).data.flatMap((one) =>
    one.items.data.map((item) => item.price.id),
  )

  fixtures
    .expect(prices, "Stripe bills the plan the page shows")
    .toEqual(["price_business_monthly"])
})
