/**
 * The agent uses Quillwork like a person would, from a plain-English goal. Each test is paired
 * with a check that needs no model: the invariant, or a value compared with Stripe. They skip
 * without a model key; once recorded, they replay with no model at all.
 */
import { test as base, z } from "@danwo/sdk"

import { expectPlansMatchStripe, type QuillworkFixtures, TEAM_PRICE_CENTS } from "./quillwork.ts"

const test = base.extend<QuillworkFixtures>()

const skip = process.env.AI_GATEWAY_API_KEY
  ? false
  : "set AI_GATEWAY_API_KEY to run the agent tests"

test("the agent starts a team on the Team plan", { skip }, async ({ app, agent }) => {
  await app.open("/")
  await agent.act(
    "create an account for the team {team} with the email {email}, then upgrade it to the Team plan and pay with Stripe's test card",
    { params: { team: "Curie", email: "marie@quillwork.test" } },
  )
  await agent.assert("the account is on the Team plan", { poll: true })
}).invariant(async (fixtures) => {
  await expectPlansMatchStripe(fixtures)

  // The model-free half: whatever the agent clicked, that team, and only it, is on the plan.
  const plans = await fixtures.sql<{ email: string; status: string }>(
    "select a.email, s.status from subscriptions s join accounts a on a.id = s.account_id",
  )

  fixtures.expect(plans).toEqual([{ email: "marie@quillwork.test", status: "active" }])
})

test(
  "the agent reads what the team pays",
  { skip, session: "team-account" },
  async ({ app, agent, expect }) => {
    await app.open("/account")

    const { plan, monthly } = await agent.extract(
      "the name of the plan the team is on, and what it costs a month in US dollars, as a number",
      z.object({ plan: z.string(), monthly: z.number() }),
    )

    // The model-free half: the page shows the plan Stripe bills, at Stripe's price.
    expect(plan).toBe("Team")
    expect(monthly * 100).toBe(TEAM_PRICE_CENTS)
  },
)
