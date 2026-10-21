/**
 * Notes: publishing one posts it to the workspace's Slack channel once (a background job on
 * Inngest), and a teammate with the workspace open sees it arrive live (Pusher).
 */
import { resendInbox, slackWorkspace, test as base } from "@danwo/sdk"

import {
  ADA,
  BOB,
  clerkMembers,
  clerkOrganizations,
  expectPostedOnce,
  expectWelcomedOnce,
  openSection,
  type RelayFixtures,
  signUp,
  WORKSPACE,
  writeNote,
} from "./relay.ts"

const test = base.extend<RelayFixtures>()

test(
  "posts a published note to Slack once",
  { session: "owner-with-slack" },
  async ({ app, screen, expect, mail, slack, settle }) => {
    await app.open("/")
    await writeNote(
      { app, screen, expect, mail },
      { title: "Weekly update", body: "Billing shipped. Next: the calendar sync." },
    )
    await settle()

    const [message] = slackWorkspace(slack).messages("#product")

    expect(message?.text).toContain("*Weekly update* by Ada Lovelace")
  },
).invariant(async (fixtures) => {
  await expectPostedOnce(fixtures)
  fixtures.expect(await fixtures.sql("select id from notes"), "one note saved").toHaveLength(1)
})

test(
  "keeps a draft out of Slack until it is published",
  { session: "owner-with-slack" },
  async ({ app, screen, expect, mail, slack, settle }) => {
    await app.open("/")
    await writeNote(
      { app, screen, expect, mail },
      { title: "Pricing ideas", body: "Rough.", draft: true },
    )
    await settle()
    expect(slackWorkspace(slack).messages("#product")).toHaveLength(0)

    await screen
      .getByRole("article", { name: "Pricing ideas" })
      .getByRole("button", { name: "Publish" })
      .click()
    await expect(
      screen.getByRole("article", { name: "Pricing ideas" }).getByText("Published"),
    ).toBeVisible()
    await settle()
    expect(slackWorkspace(slack).messages("#product")).toHaveLength(1)
  },
).invariant(expectPostedOnce)

test(
  "a teammate sees a published note live",
  { session: "owner-in-workspace" },
  async ({ app, screen, expect, mail, users }) => {
    await app.open("/")
    await openSection({ app, screen, expect, mail }, "Settings")
    await screen.getByRole("link", { name: "Members" }).click()
    await screen.getByLabel("Email address").fill(BOB.email)
    await screen.getByRole("button", { name: "Send invite" }).click()
    await expect(screen.getByRole("status")).toHaveText(`Invitation sent to ${BOB.email}.`)

    /* Bob signs up in his own browser and accepts; the front door finds his invitation. */
    const bob = await users.open("bob")

    await signUp(bob, BOB)
    await bob.expect(bob.screen.getByRole("heading", { name: `Join ${WORKSPACE}` })).toBeVisible()
    await bob.screen.getByRole("button", { name: "Accept the invitation" }).click()
    await bob.expect(bob.screen.getByRole("heading", { level: 1, name: "Notes" })).toBeVisible()

    await openSection({ app, screen, expect, mail }, "Notes")
    await writeNote(
      { app, screen, expect, mail },
      { title: "Q4 roadmap", body: "1. Calendar sync\n2. Mobile app" },
    )

    /* No reload: the note reaches Bob's open page over Pusher. */
    await bob.expect(bob.screen.getByRole("article", { name: "Q4 roadmap" })).toBeVisible()
    await bob
      .expect(bob.screen.getByRole("status"))
      .toHaveText(`${ADA.name} published “Q4 roadmap”`)
  },
).invariant(async (fixtures) => {
  const { sql, clerk, resend, expect } = fixtures
  const [org] = await clerkOrganizations(clerk)
  const members = await sql<{ email: string; role: string }>(
    "select u.email, m.role from members m join users u on u.id = m.user_id order by u.email",
  )

  expect(members, "Ada and Bob are members").toEqual([
    { email: ADA.email, role: "org:admin" },
    { email: BOB.email, role: "org:member" },
  ])
  expect(
    clerkMembers(clerk, org?.id ?? "").toSorted((a, b) =>
      (a.email ?? "").localeCompare(b.email ?? ""),
    ),
    "and so are they in the Clerk organization",
  ).toEqual(members)
  expect(
    resendInbox(resend)
      .list(BOB.email)
      .filter((email) => email.subject.includes(`invited you to ${WORKSPACE}`)),
    "one invitation email",
  ).toHaveLength(1)
  await expectWelcomedOnce(fixtures)
})
