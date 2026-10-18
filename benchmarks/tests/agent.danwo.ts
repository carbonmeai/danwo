/**
 * Every scenario written for the agent alone: it does the steps from plain instructions, waits for
 * what each step should lead to (which is what lets a step be kept as a recording), and reads the
 * outcome off the page with `extract` for plain expectations to judge. With the committed
 * recordings these replay with no model calls.
 */
import { z } from "@danwo/sdk"

import {
  accountsVerified,
  borealisDeleted,
  paymentsHold,
  resetApp,
  settingsValid,
  stateOf,
  teamNotified,
  test,
} from "./truth.ts"

test.beforeEach(resetApp)

const SIGNUP_EMAIL = "kai@bench.test"
const Message = z.object({ message: z.string() })
const Summary = z.object({ summary: z.string() })

test("signup [agent]", async ({ app, agent, expect }) => {
  await app.open("/signup")
  await agent.act("sign up with the email {email}, then enter the code emailed to it", {
    params: { email: SIGNUP_EMAIL },
  })
  await agent.waitFor("the page confirms the sign-up")

  const { message } = await agent.extract(
    "the confirmation message shown after signing up",
    Message,
  )

  expect(message).toContain(SIGNUP_EMAIL)
}).invariant(accountsVerified)

test("checkout [agent]", async ({ app, agent, expect }) => {
  await app.open("/checkout")

  const { total } = await agent.extract(
    "the cart total in dollars",
    z.object({ total: z.number() }),
  )

  expect(total).toBe(24)
  await agent.act(
    "continue to payment, approve the payment when the bank asks, then pay on the payment page",
  )
  await agent.waitFor("the order status says Paid")
}).invariant(paymentsHold)

test("orders [agent]", async ({ app, agent, expect }) => {
  await app.open("/checkout")
  await agent.act("buy the cart: continue to payment, approve it, and pay on the payment page")
  await agent.waitFor("the order status says Paid")
  await app.open("/orders")

  const { status } = await agent.extract(
    "the status of the order in the orders table",
    z.object({ status: z.string() }),
  )

  expect(status).toBe("Paid")
}).invariant(paymentsHold)

test("settings [agent]", async ({ app, agent, expect }) => {
  await app.open("/settings")
  await agent.act("type {email} into the Email field and press Save settings", {
    params: { email: "ada-at-lovelace" },
  })
  await agent.waitFor("an error says the email address is not valid")

  const { error } = await agent.extract(
    "the error message next to the email field",
    z.object({ error: z.string() }),
  )

  expect(error).toBe("Enter a valid email address")
  await agent.act("type {email} into the Email field and press Save settings", {
    params: { email: "ada@lovelace.test" },
  })
  await agent.waitFor("the page says the settings were saved")
  expect(
    (await agent.extract("the message saying whether settings were saved", Message)).message,
  ).toBe("Settings saved")
}).invariant(settingsValid)

test("products [agent]", async ({ app, agent, expect }) => {
  await app.open("/products")
  await agent.act("go to the last page of the product table using the Next button")
  await agent.waitFor("the table is on its last page")

  expect((await agent.extract("the paging summary next to the Next button", Summary)).summary).toBe(
    "Page 3 of 3 · 30 products",
  )
  await agent.act("filter the products by {category}", { params: { category: "software" } })
  await agent.waitFor("the table shows only software products")

  expect((await agent.extract("the paging summary next to the Next button", Summary)).summary).toBe(
    "Page 1 of 1 · 10 products",
  )
})

test("projects [agent]", async ({ app, agent }) => {
  await app.open("/projects")
  await agent.act("delete the Borealis project and confirm the deletion")
  await agent.waitFor("the page says there are 2 projects")
}).invariant(borealisDeleted)

test("upload [agent]", async ({ app, agent, expect }) => {
  await app.open("/upload")
  await agent.act("attach the file named notes and upload it")
  await agent.waitFor("the page says the file was uploaded")
  expect((await agent.extract("the upload confirmation message", Message)).message).toBe(
    "Uploaded notes.txt (49 bytes)",
  )
})

test("newsletter [agent]", async ({ app, agent, expect }) => {
  await app.open("/newsletter")
  await agent.act("subscribe to the newsletter with the email {email} in the sign-up widget", {
    params: { email: "news@bench.test" },
  })
  await agent.waitFor("the page says the email is subscribed")
  expect((await stateOf(app.baseUrl)).subscribers).toContain("news@bench.test")
})

test("approve [agent]", async ({ app, agent }) => {
  await app.open("/approve")
  await agent.act("press the green Approve button drawn on the board")
  await agent.waitFor("the page says Approved")
})

test("team [agent]", async ({ app, agent }) => {
  await app.open("/team")
  await agent.act("notify the team")
  await agent.waitFor("the page says the team was notified")
}).invariant(teamNotified)

test("report [agent]", async ({ app, agent }) => {
  await app.open("/report")
  await agent.act("generate the report")
  await agent.waitFor("the status line reads exactly: Ready: 42 rows")
})
