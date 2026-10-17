import { type Emulator, type SlackFixtures, slackWorkspace, test as base, z } from "@danwo/sdk"

const test = base.extend<SlackFixtures & { readonly botToken: string }>()

/** The bot's member id, as `auth.test` reports it for its token. */
async function botUserOf(slack: Emulator, token: string): Promise<string> {
  const response = await slack.fetch(
    new Request("https://slack.com/api/auth.test", {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
    }),
  )

  return z.object({ user_id: z.string() }).parse(await response.json()).user_id
}

test("replies in the thread when mentioned", async ({
  app,
  screen,
  slack,
  botToken,
  settle,
  expect,
}) => {
  const bot = await botUserOf(slack, botToken)

  slackWorkspace(slack).post("ada", "general", `<@${bot}> can you look at the build?`)
  await settle()

  await app.open("/")
  await expect(screen.getByRole("status")).toHaveText("Replies: 1", { timeout: 3_000 })
}).invariant(async ({ slack, expect }) => {
  /*
   * Whichever way the run went, no mention is answered more than once: an event Slack delivers
   * twice must not make the bot reply twice.
   */
  const messages = slackWorkspace(slack).messages("general")
  const mentions = messages.filter((message) => message.botId === null && message.threadTs === null)

  for (const mention of mentions) {
    const replies = messages.filter((m) => m.botId !== null && m.threadTs === mention.ts)

    expect(replies.length).toBeLessThanOrEqual(1)
  }
})
