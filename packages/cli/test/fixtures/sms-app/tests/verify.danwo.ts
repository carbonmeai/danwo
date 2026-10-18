import { test as base, twilioInbox, type TwilioFixtures } from "@danwo/sdk"

const test = base.extend<TwilioFixtures>()
const PHONE = "+14155550123"

test("verifies a phone with a texted code and counts the welcome", async ({
  app,
  screen,
  twilio,
  settle,
  expect,
}) => {
  await app.open("/")
  await screen.getByLabel("Phone").fill(PHONE)
  await screen.getByRole("button", { name: "Send code" }).click()

  const code = twilioInbox(twilio).latest(PHONE)?.code() ?? ""

  await screen.getByLabel("Code").fill(code)
  await screen.getByRole("button", { name: "Verify" }).click()
  await expect(screen.getByRole("heading", { name: `Verified ${PHONE}` })).toBeVisible()
  await settle()
  await app.open("/")
  await expect(screen.getByRole("status")).toHaveText("Welcomes delivered: 1")
}).invariant(async ({ app, screen, twilio, settle, expect }) => {
  /*
   * Whichever way the run went, the app never counts more welcomes as delivered than Twilio
   * delivered: a status callback sent twice must not be counted twice.
   */
  await settle()

  const deliveredByTwilio = twilioInbox(twilio)
    .list(PHONE)
    .filter((text) => text.body === "Welcome aboard!" && text.status === "delivered").length

  await app.open("/")

  const shown = Number(/\d+/.exec(await screen.getByRole("status").innerText())?.[0] ?? 0)

  expect(shown).toBeLessThanOrEqual(deliveredByTwilio)
})
