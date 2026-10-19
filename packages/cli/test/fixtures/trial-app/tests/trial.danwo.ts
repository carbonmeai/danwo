import { type BachsFixtures, bachsLedger, test as base, z } from "@danwo/sdk"

const test = base.extend<BachsFixtures>()

/** The app's own view of the customer, as its `/state.json` reports it. */
const State = z.object({ status: z.string(), access: z.boolean(), receipts: z.number() })

/** Whether the customer's subscription is one they may use the product in. */
const LIVE = new Set(["trialing", "active"])

test("a trial turns into a paid plan, and a card that stops working ends access", async ({
  app,
  screen,
  expect,
  time,
  settle,
  bachs,
}) => {
  await app.open("/")
  await screen.getByRole("button", { name: "Start 14-day trial" }).click()
  await screen.getByTestId("bachs-pay").click()
  await settle()
  await app.open("/account")
  await expect(screen.getByRole("status")).toHaveText("Plan: trialing")
  await expect(screen.getByTestId("access")).toHaveText("Access: granted")
  await expect(screen.getByTestId("receipts")).toHaveText("Receipts: 0")

  /* The trial ends on day 14: the first charge goes through, and access carries on. */
  await time.travel({ days: 15 })
  await settle()
  await app.open("/account")
  await expect(screen.getByRole("status")).toHaveText("Plan: active")
  await expect(screen.getByTestId("access")).toHaveText("Access: granted")
  await expect(screen.getByTestId("receipts")).toHaveText("Receipts: 1")

  /* The card stops working before the next renewal; after Bachs's retries the plan ends. */
  const ledger = bachsLedger(bachs)
  const [subscription] = ledger.subscriptions()

  ledger.failCard(String(subscription?.id), "declined")
  await time.travel({ days: 40 })
  await settle()
  await app.open("/account")
  await expect(screen.getByRole("status")).toHaveText("Plan: canceled")
  await expect(screen.getByTestId("access")).toHaveText("Access: revoked")
  expect(ledger.recoveryEmails("ada@danwo-shop.com").length).toBeGreaterThan(0)
}).invariant(async ({ app, bachs, settle, expect }) => {
  /*
   * Whichever way the run went: one receipt per paid invoice, never more, and no access without a
   * subscription that is trialing or paid up.
   */
  await settle()

  const ledger = bachsLedger(bachs)
  const paid = ledger.succeeded().length
  const live = ledger.subscriptions().some((subscription) => LIVE.has(subscription.status))
  const state = State.parse(await (await fetch(new URL("/state.json", app.baseUrl))).json())

  expect(state.receipts).toBeLessThanOrEqual(paid)
  expect(state.access).toBe(state.access && live)
})
