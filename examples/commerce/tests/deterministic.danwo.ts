import { resendInbox, test as base } from "@danwo/sdk"

import {
  CUSTOMER,
  DECLINED_CARD,
  expectBooksBalance,
  expectOneSessionPerCart,
  pay,
  type ShopFixtures,
} from "./shop.ts"

const test = base.extend<ShopFixtures>()

test("browses the shop and fills a cart", async ({ app, screen, expect }) => {
  await app.open("/")
  await expect(screen.getByRole("heading", { name: "Things for slow mornings" })).toBeVisible()
  await expect(screen.getByRole("link", { name: /Tide print/ })).toContainText("Sold out")

  await screen.getByRole("link", { name: "Mugs", exact: true }).click()
  await expect(screen.getByRole("link", { name: /Hills print/ })).toBeHidden()
  await screen.getByRole("link", { name: /Speckled mug/ }).click()

  await expect(screen.getByRole("heading", { name: "Speckled mug" })).toBeVisible()
  await expect(screen.getByRole("img", { name: "Speckled mug" })).toBeVisible()
  await screen.getByLabel("Quantity").selectOption("2")
  await screen.getByRole("button", { name: "Add to cart" }).click()

  await expect(screen.getByTestId("cart-total")).toHaveText("$36.00")
  await expect(screen.getByRole("link", { name: "Cart, 2 items" })).toBeVisible()
}).invariant(async (fixtures) => {
  // A full cart is not an order: nothing is paid, so nothing is owed.
  await expectBooksBalance(fixtures)
  fixtures.expect(await fixtures.sql("select id from orders")).toHaveLength(0)
})

test("pays for a mug through Stripe Checkout", async ({ app, screen, expect }) => {
  await pay({ app, screen, expect }, { product: "little-mug", email: "sam@paperandclay.test" })

  await expect(screen.getByRole("heading", { name: "Thank you for your order" })).toBeVisible()
  await expect(screen.getByTestId("order-total")).toHaveText("$14.00")
  await expect(screen.getByRole("link", { name: "Cart, 0 items" })).toBeVisible()
}).invariant(async (fixtures) => {
  await expectBooksBalance(fixtures)
  await expectOneSessionPerCart(fixtures)
})

test("a declined card shows Stripe's error and places no order", async ({
  app,
  screen,
  expect,
}) => {
  await pay(
    { app, screen, expect },
    { product: "hills-print", email: "kit@paperandclay.test", card: DECLINED_CARD },
  )

  await expect(screen.getByRole("alert")).toHaveText("Your card was declined.")

  await app.open("/orders?email=kit%40paperandclay.test")
  await expect(screen.getByText("No orders yet")).toBeVisible()
}).invariant(async (fixtures) => {
  await expectBooksBalance(fixtures)
  fixtures.expect(await fixtures.sql("select id from orders")).toHaveLength(0)
  fixtures.expect(resendInbox(fixtures.resend).list("kit@paperandclay.test")).toHaveLength(0)
})

test(
  "refunds an order from the admin",
  { session: "returning-customer" },
  async ({ app, screen, expect }) => {
    await app.open("/admin/orders")
    await expect(screen.getByRole("row", { name: new RegExp(CUSTOMER) })).toContainText("Paid")

    await screen.getByRole("button", { name: /^Refund order PC-/ }).click()

    await expect(screen.getByRole("status")).toContainText("was refunded")
    await expect(screen.getByRole("row", { name: new RegExp(CUSTOMER) })).toContainText("Refunded")
  },
).invariant(async (fixtures) => {
  await expectBooksBalance(fixtures)
})
