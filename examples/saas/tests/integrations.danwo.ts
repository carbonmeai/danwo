/**
 * Integrations: connecting Slack and Google Calendar through their own consent pages, with the
 * tokens kept per workspace, and what each is for once connected.
 */
import { googleCalendar, googleSignIns, test as base, type GoogleFixtures } from "@danwo/sdk"

import {
  ADA,
  connectSlack,
  expectPostedOnce,
  openSection,
  type RelayFixtures,
  writeNote,
} from "./relay.ts"

const test = base.extend<RelayFixtures & GoogleFixtures>()

test(
  "connects Slack and Google Calendar, and books a review",
  { session: "owner-in-workspace" },
  async ({ app, screen, expect, mail, google }) => {
    const steps = { app, screen, expect, mail }

    await app.open("/")
    await connectSlack(steps, "product")
    await expect(
      screen.getByRole("region", { name: "Slack" }).getByText("Connected", { exact: true }),
    ).toBeVisible()

    await screen.getByRole("button", { name: "Connect Google Calendar" }).click()
    await screen.getByRole("button", { name: `Continue as ${ADA.name}` }).click()
    await expect(
      screen.getByRole("status").filter({ hasText: "Google Calendar is connected" }),
    ).toBeVisible()
    await expect(screen.getByRole("list", { name: "Coming up" })).toContainText(
      "Planning with the team",
    )

    await openSection(steps, "Notes")
    await writeNote(steps, { title: "Launch checklist", body: "Docs, pricing page, the email." })
    await screen.getByRole("link", { name: "Launch checklist" }).click()
    await screen.getByRole("button", { name: "Book a review in Google Calendar" }).click()
    await expect(screen.getByRole("status")).toContainText("Review booked in Google Calendar")

    expect(googleSignIns(google).latest()?.redeemed).toBe(true)
  },
).invariant(async (fixtures) => {
  await expectPostedOnce(fixtures)

  const connected = await fixtures.sql<{ provider: string; status: string; external_name: string }>(
    "select provider, status, external_name from integrations order by provider",
  )

  fixtures.expect(connected, "both connected, each with its account").toEqual([
    { provider: "google", status: "connected", external_name: ADA.email },
    { provider: "slack", status: "connected", external_name: "Acme" },
  ])
  fixtures
    .expect(
      googleCalendar(fixtures.google, ADA.email)
        .events()
        .filter((event) => event.summary === "Review: Launch checklist"),
      "one review meeting",
    )
    .toHaveLength(1)
})
