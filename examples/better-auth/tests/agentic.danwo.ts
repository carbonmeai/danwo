/**
 * The agent signs in like a person would, from a plain-English goal, reading Harbor's emailed code
 * itself. Each test is paired with a check that needs no model: what the page shows, compared with
 * Harbor's own database. They skip without a model key; once recorded, they replay with no model.
 */
import { z } from "@danwo/sdk"

import { accountsHold, ADA, sessionsOf, test } from "./harbor.ts"

const skip = process.env.AI_GATEWAY_API_KEY
  ? false
  : "set AI_GATEWAY_API_KEY to run the agent tests"

test(
  "the agent signs in as Ada with the code Harbor emails",
  { skip },
  async ({ app, agent, screen, expect, databaseUrl }) => {
    await app.open("/sign-in")
    await agent.act("sign in as {email} with the code Harbor emails her", {
      params: { email: ADA.email },
    })

    /* The model-free half: Ada's dashboard, and one session for her in Harbor's database. */
    await expect(screen.getByRole("heading", { name: "Welcome, Ada" })).toBeVisible()
    expect(await sessionsOf(databaseUrl, ADA.email)).toHaveLength(1)
    await agent.assert("the page welcomes Ada")
  },
).invariant(accountsHold)

test(
  "the agent counts Ada's signed-in devices",
  { skip, session: "signed-in-ada" },
  async ({ app, agent, expect, databaseUrl }) => {
    await app.open("/settings")

    const { devices } = await agent.extract(
      "how many devices are signed in as this person",
      z.object({ devices: z.number() }),
    )

    /* The model-free half: the number the agent read is how many sessions Harbor keeps for her. */
    expect(devices).toBe((await sessionsOf(databaseUrl, ADA.email)).length)
  },
)
