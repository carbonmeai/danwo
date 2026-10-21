/**
 * The agent signs in like a person would, from a plain-English goal, reading Clerk's emailed code
 * itself. Each test is paired with a check that needs no model: what the page shows, compared with
 * Clerk's emulator and the app's database. They skip without a model key; once recorded, they
 * replay with no model at all.
 */
import { clerkInstance, z } from "@danwo/sdk"

import { accountsAgree, ADA, ADA_IDS, ADAS_ORG, test } from "./lumen.ts"

const skip = process.env.AI_GATEWAY_API_KEY
  ? false
  : "set AI_GATEWAY_API_KEY to run the agent tests"

test(
  "the agent signs in as Ada and opens her organization",
  { skip },
  async ({ app, agent, screen, expect }) => {
    await app.open("/")
    await agent.act(
      "sign in as {email} with the code Clerk emails her, then open her organization",
      { params: { email: ADA.email } },
    )

    /* The model-free half: Ada's organization is on the screen, with her in it as its admin. */
    await expect(screen.getByRole("heading", { name: ADAS_ORG.name })).toBeVisible()
    await expect(screen.getByRole("row", { name: new RegExp(ADA.email) })).toContainText("Admin")
    await agent.assert("the page shows the members of Ada's organization")
  },
).invariant(accountsAgree)

test(
  "the agent counts the members of Ada's organization",
  { skip, session: "ada-org-owner" },
  async ({ app, agent, clerk, expect }) => {
    await app.open("/organization")

    const { members } = await agent.extract(
      "how many members the organization has",
      z.object({ members: z.number() }),
    )

    /* The model-free half: the number the agent read is how many members Clerk has. */
    expect(members).toBe(clerkInstance(clerk).memberships(ADA_IDS.org).length)
  },
)
