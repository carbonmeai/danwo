import { joinedOnce, test } from "./waitlist.ts"

/* Agent steps call the model in danwo.config.ts. Without a key this test is skipped. */
const skip = process.env.AI_GATEWAY_API_KEY ? false : "set AI_GATEWAY_API_KEY to run agent tests"

const EMAIL = "grace@lumen.example"

test("the agent joins the waitlist", { skip }, async ({ agent, screen, expect }) => {
  /* The agent reads the native screen and works out which field and button to use. */
  await agent.act("join the waitlist with the email {email}", { params: { email: EMAIL } })

  /* Pair each agent step with a check that does not depend on the model. */
  await expect(screen.getByTestId("status")).toHaveText("You're on the list")
  await agent.assert("the screen confirms the email joined the waitlist")
}).invariant((fixtures) => joinedOnce({ ...fixtures, email: EMAIL }))
