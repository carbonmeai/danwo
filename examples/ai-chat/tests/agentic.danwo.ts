import { resendInbox } from "@danwo/sdk"

import { agentSkip } from "./agent-model.ts"
import { settled, supportHeld, test, tickets } from "./support.ts"

/*
 * Two models take part here. danwo's agent drives the page on the model in danwo.config.ts, which
 * needs AI_GATEWAY_API_KEY (or DANWO_MODEL=scripted); without one this test is skipped. The app's
 * own model is the emulator's, as in every other test, so it costs nothing and answers the same.
 */
const skip = agentSkip()

test(
  "the agent asks the assistant to open a ticket",
  { skip },
  async ({ app, agent, screen, expect, resend, databaseUrl }) => {
    await app.open("/")

    /* The agent works out where to type and what to press. */
    await agent.act(
      "ask the assistant to open a ticket for order 1042 because the mug arrived broken",
    )
    await settled(screen, expect)

    /* Pair each agent step with a check that does not depend on the model. */
    await expect(screen.getByTestId("ticket-card")).toContainText("Ticket opened")
    expect(await tickets(databaseUrl)).toHaveLength(1)
    expect(resendInbox(resend).list("ada@example.com")).toHaveLength(1)
    await agent.assert("the assistant says it opened a ticket")
  },
).invariant(supportHeld)
