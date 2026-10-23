/**
 * What Quillwork's tests share: signing a team up, paying for the Team plan on Stripe's page, and
 * the invariants. Each invariant reads one fact from two sides, the app's database and the
 * provider's emulator, and must hold however a trial went: paid, declined, retried or faulted.
 */
import {
  type DanwoFixtures,
  type Emulator,
  type InboxEmail,
  type ResendFixtures,
  resendInbox,
  type StripeFixtures,
  z,
} from "@danwo/sdk"

import type { Sql } from "./db.ts"

/** Not a real key: the emulator accepts any well-formed one. */
export const STRIPE_SECRET_KEY = "sk_test_quillwork"

/** The Team plan's monthly price in Stripe, and what it costs. */
export const TEAM_PLAN = "price_team_monthly"
export const TEAM_PRICE_CENTS = 2400

/** The subject of the email a team gets when its plan starts (`welcomeSubject` in mail.go). */
export const WELCOME_SUBJECT = "Welcome to Quillwork Team"

/** Stripe's declining test card. */
export const DECLINED_CARD = "4000 0000 0000 0002"

/** What every Quillwork test receives: the emulators, and SQL on this worker's database. */
export type QuillworkFixtures = StripeFixtures & ResendFixtures & { readonly sql: Sql }

type Steps = Pick<DanwoFixtures, "app" | "screen" | "expect">

/** A team signing up. */
export interface Team {
  readonly email: string
  readonly team: string
}

/** Signs `team` up from the home page, and waits for its account page. */
export async function signUp({ app, screen, expect }: Steps, team: Team): Promise<void> {
  await app.open("/")
  await screen.getByLabel("Work email").fill(team.email)
  await screen.getByLabel("Team name").fill(team.team)
  await screen.getByRole("button", { name: "Create account" }).click()
  await expect(screen.getByRole("heading", { name: team.team })).toBeVisible()
}

/**
 * Signs `team` up and pays for the Team plan on Stripe's page, with `card` (Stripe's Visa test
 * card unless given). It stops once Pay is pressed.
 */
export async function pay(steps: Steps, team: Team & { readonly card?: string }): Promise<void> {
  const { screen, expect } = steps

  await signUp(steps, team)
  await screen.getByRole("button", { name: "Upgrade to Team" }).click()
  await expect(screen.getByTestId("checkout-total")).toHaveText("$24.00")
  if (team.card) await screen.getByLabel("Card number").fill(team.card)
  await screen.getByTestId("checkout-pay").click()
}

/** `pay`, then waits until the account page shows the Team plan. */
export async function upgrade(steps: Steps, team: Team): Promise<void> {
  await pay(steps, team)
  await steps.expect(steps.screen.getByTestId("plan-name")).toHaveText("Team")
}

const Subscriptions = z.object({
  data: z.array(
    z.object({
      id: z.string(),
      status: z.string(),
      metadata: z.record(z.string(), z.string()),
    }),
  ),
})
const Sessions = z.object({
  data: z.array(
    z.object({
      id: z.string(),
      client_reference_id: z.string().nullable(),
      status: z.string().nullable(),
      subscription: z.string().nullable(),
    }),
  ),
})

/** One page of a Stripe list, read from the emulator the way the app's own client would. */
async function stripeList(stripe: Emulator, path: string): Promise<unknown> {
  const res = await stripe.fetch(
    new Request(`https://api.stripe.com/v1/${path}`, {
      headers: { authorization: `Bearer ${STRIPE_SECRET_KEY}` },
    }),
  )

  return res.json()
}

interface PlanRow {
  readonly account_id: string
  readonly stripe_subscription_id: string
  readonly status: string
}

interface AccountRow {
  readonly id: string
  readonly email: string
}

/** Whether a subscription status gives a team the plan, as `OnTeamPlan` in accounts.go says. */
function onPlan(status: string): boolean {
  return status === "active" || status === "trialing"
}

/** The welcome emails Resend accepted, waiting a little for any still being retried. */
async function welcomesFor(resend: Emulator, owed: number): Promise<InboxEmail[]> {
  const deadline = Date.now() + 20_000
  const welcomes = () =>
    resendInbox(resend)
      .list()
      .filter((email) => email.subject === WELCOME_SUBJECT)

  while (welcomes().length < owed && Date.now() < deadline)
    await new Promise((resolve) => setTimeout(resolve, 200))

  return welcomes()
}

/**
 * The app's plans agree with Stripe and Resend:
 * - exactly one plan row per Stripe subscription, for the account its checkout named;
 * - each plan's status is what Stripe says now, so a team is on the Team plan exactly when its
 *   subscription is active, and no team has two active plans;
 * - exactly one welcome email per team on the plan, to its address, and none for any other team;
 * - at most one Checkout Session per team, however often the button was pressed.
 */
export async function expectPlansMatchStripe({
  sql,
  stripe,
  resend,
  expect,
}: QuillworkFixtures & Pick<DanwoFixtures, "expect">): Promise<void> {
  const subscriptions = Subscriptions.parse(
    await stripeList(stripe, "subscriptions?status=all&limit=100"),
  ).data
  const sessions = Sessions.parse(await stripeList(stripe, "checkout/sessions?limit=100")).data
  const plans = await sql<PlanRow>(
    "select account_id::text, stripe_subscription_id, status from subscriptions order by id",
  )
  const accounts = await sql<AccountRow>("select id::text, email from accounts order by id")

  expect(
    plans.map((plan) => plan.stripe_subscription_id).toSorted(),
    "one plan per Stripe subscription",
  ).toEqual(subscriptions.map((subscription) => subscription.id).toSorted())

  for (const plan of plans) {
    const subscription = subscriptions.find((s) => s.id === plan.stripe_subscription_id)
    const session = sessions.find((s) => s.subscription === plan.stripe_subscription_id)

    expect(plan.status, `${plan.stripe_subscription_id}: the status Stripe has`).toBe(
      subscription?.status,
    )
    expect(plan.account_id, `${plan.stripe_subscription_id}: the account its checkout named`).toBe(
      session?.client_reference_id,
    )
  }

  const onTeamPlan = accounts.filter((account) =>
    plans.some((plan) => plan.account_id === account.id && onPlan(plan.status)),
  )

  for (const account of accounts)
    expect(
      plans.filter((plan) => plan.account_id === account.id && onPlan(plan.status)).length,
      `${account.email}: at most one active plan`,
    ).toBeLessThanOrEqual(1)

  const welcomes = await welcomesFor(resend, onTeamPlan.length)

  expect(welcomes, "one welcome email per team on the plan").toHaveLength(onTeamPlan.length)
  for (const account of onTeamPlan)
    expect(
      welcomes.filter((email) => email.to.includes(account.email)),
      `one welcome email for ${account.email}`,
    ).toHaveLength(1)

  const started = sessions.map((session) => session.client_reference_id)

  expect(started, "one Checkout Session per team").toEqual([...new Set(started)])
}
