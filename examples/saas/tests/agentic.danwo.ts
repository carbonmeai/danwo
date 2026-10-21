/**
 * The agent works in Relay like a person would, from a plain-English goal. Each test is paired
 * with a check that needs no model: the invariants, and the rows the goal should have left. They
 * skip without a model key; once recorded, they replay with no model at all.
 */
import { resendInbox, test as base } from "@danwo/sdk"

import { BOB, expectPostedOnce, expectStatusMatchesStripe, type RelayFixtures } from "./relay.ts"

const test = base.extend<RelayFixtures>()

const skip = process.env.AI_GATEWAY_API_KEY
  ? false
  : "set AI_GATEWAY_API_KEY to run the agent tests"

test(
  "invites Bob and shares the roadmap note",
  { skip, session: "owner-with-slack" },
  async ({ app, agent }) => {
    await app.open("/")
    await agent.act(
      "invite {email} to the workspace, then write a note titled Roadmap that lists two things we will build next quarter, and publish it to the team",
      { params: { email: BOB.email } },
    )
    await agent.assert("the Roadmap note is published", { poll: true })
  },
).invariant(async (fixtures) => {
  await expectPostedOnce(fixtures)

  // The model-free half: whatever the agent clicked, Bob is invited once and the note is out.
  const invited = await fixtures.sql<{ email: string }>("select email from invites")
  const notes = await fixtures.sql<{ title: string; published: boolean }>(
    "select title, published_at is not null as published from notes",
  )

  fixtures.expect(invited).toEqual([{ email: BOB.email }])
  fixtures
    .expect(notes.map((note) => ({ ...note, title: note.title.trim() })))
    .toEqual([{ title: "Roadmap", published: true }])
  fixtures
    .expect(resendInbox(fixtures.resend).list(BOB.email), "one invitation email")
    .toHaveLength(1)
})

test(
  "moves to the plan with room for the most people",
  { skip, session: "owner-in-workspace" },
  async ({ app, agent, sql, expect }) => {
    await app.open("/")
    await agent.act("switch this workspace to the plan that allows the most members")
    await agent.assert("the billing page shows the new plan", { poll: true })

    // The model-free half: the plan with the most members is Business, and that is what is saved.
    const [workspace] = await sql<{ plan: string }>("select plan from workspaces")

    expect(workspace?.plan).toBe("business_monthly")
  },
).invariant(expectStatusMatchesStripe)
