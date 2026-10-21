import { joinedOnce, test } from "./waitlist.ts"

/* Agent steps call the model in danwo.config.ts. Without a key these tests are skipped. */
const skip = process.env.AI_GATEWAY_API_KEY ? false : "set AI_GATEWAY_API_KEY to run agent tests"

const EMAIL = "grace@lumen.example"

test("the agent joins the waitlist", { skip }, async ({ app, agent, screen, expect }) => {
  await app.open("/")

  /* The agent works out which field and button to use. */
  await agent.act("join the waitlist with the email {email}", { params: { email: EMAIL } })

  /* Pair each agent step with a check that does not depend on the model. */
  await expect(screen.getByRole("status")).toContainText("You're on the list")
  await agent.assert("the page confirms the email joined the waitlist")
}).invariant((fixtures) => joinedOnce({ ...fixtures, email: EMAIL }))

test(
  "the agent finds the invalid-email error",
  { skip },
  async ({ app, agent, screen, expect }) => {
    await app.open("/")

    await agent.act("try to join the waitlist with the email {email}", {
      params: { email: "grace-at-lumen" },
    })

    await expect(
      screen.getByRole("alert").filter({ hasText: "Enter a valid email address." }),
    ).toBeVisible()
    await agent.assert("the page asks for a valid email address")
  },
)
