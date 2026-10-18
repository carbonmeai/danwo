/**
 * Every scenario written the way most teams would mix the two: the agent does the steps that are
 * easier to say than to pin down, and locators check the outcome exactly.
 */
import {
  accountsVerified,
  borealisDeleted,
  paymentsHold,
  resetApp,
  settingsValid,
  teamNotified,
  test,
} from "./truth.ts"

test.beforeEach(resetApp)

const SIGNUP_EMAIL = "mo@bench.test"

test("signup [mixed]", async ({ app, agent, screen, expect }) => {
  await app.open("/signup")
  await agent.act("sign up with the email {email}, then enter the code emailed to it", {
    params: { email: SIGNUP_EMAIL },
  })
  await expect(screen.getByRole("status")).toHaveText(`Signed up as ${SIGNUP_EMAIL}`)
}).invariant(accountsVerified)

test("checkout [mixed]", async ({ app, agent, screen, expect }) => {
  await app.open("/checkout")
  await expect(screen.getByTestId("cart-total")).toHaveText("$24.00")
  await agent.act(
    "continue to payment, approve the payment when the bank asks, then pay on the payment page",
  )
  await expect(screen.getByTestId("order-status")).toHaveText("Paid")
}).invariant(paymentsHold)

test("orders [mixed]", async ({ app, agent, screen, expect }) => {
  await app.open("/checkout")
  await agent.act("buy the cart: continue to payment, approve it, and pay on the payment page")
  await expect(screen.getByTestId("order-status")).toHaveText("Paid")
  await app.open("/orders")
  await expect(screen.getByRole("table", { name: "Orders" })).toContainText("Paid")
}).invariant(paymentsHold)

test("settings [mixed]", async ({ app, agent, screen, expect }) => {
  await app.open("/settings")
  await agent.act("type {email} into the Email field and press Save settings", {
    params: { email: "ada-at-lovelace" },
  })
  await expect(screen.getByRole("alert")).toHaveText("Enter a valid email address")
  await agent.act("type {email} into the Email field and press Save settings", {
    params: { email: "ada@lovelace.test" },
  })
  await expect(screen.getByRole("status")).toHaveText("Settings saved")
}).invariant(settingsValid)

test("products [mixed]", async ({ app, agent, screen, expect }) => {
  await app.open("/products")
  await agent.act("go to the last page of the product table using the Next button")
  await expect(screen.getByRole("status")).toHaveText("Page 3 of 3 · 30 products")
  await agent.act("filter the products by {category}", { params: { category: "software" } })
  await expect(screen.getByRole("status")).toHaveText("Page 1 of 1 · 10 products")
})

test("projects [mixed]", async ({ app, agent, screen, expect }) => {
  await app.open("/projects")
  await agent.act("delete the Borealis project and confirm the deletion")
  await expect(screen.getByRole("status")).toHaveText("2 projects")
}).invariant(borealisDeleted)

test("upload [mixed]", async ({ app, agent, screen, expect }) => {
  await app.open("/upload")
  await agent.act("attach the file named notes and upload it")
  await expect(screen.getByRole("status")).toHaveText("Uploaded notes.txt (49 bytes)")
})

test("newsletter [mixed]", async ({ app, agent, screen, expect }) => {
  await app.open("/newsletter")
  await agent.act("subscribe to the newsletter with the email {email} in the sign-up widget", {
    params: { email: "news@bench.test" },
  })
  await expect(screen.getByRole("status")).toHaveText("Subscribed: news@bench.test")
})

test("approve [mixed]", async ({ app, agent, screen, expect }) => {
  await app.open("/approve")
  await agent.act("press the green Approve button drawn on the board")
  await expect(screen.getByRole("status")).toHaveText("Approved")
})

test("team [mixed]", async ({ app, agent, screen, expect }) => {
  await app.open("/team")
  await agent.act("notify the team")
  await expect(screen.getByRole("status")).toHaveText("Team notified")
}).invariant(teamNotified)

test("report [mixed]", async ({ app, agent, screen, expect }) => {
  await app.open("/report")
  await agent.act("generate the report")
  await expect(screen.getByRole("status")).toHaveText("Ready: 42 rows")
})
