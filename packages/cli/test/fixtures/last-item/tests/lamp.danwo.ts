import { test, z } from "@danwo/sdk"

/** The shop's books, as its `/stock.json` reports them. */
const Books = z.object({ stock: z.number(), orders: z.number() })

test("buys the last lamp", { concurrent: 2 }, async ({ app, screen, expect }) => {
  await app.open("/")
  await screen.getByRole("button", { name: "Buy the lamp" }).click()
  await expect(screen.getByRole("heading", { name: /the lamp is yours|sold out/ })).toBeVisible()
}).invariant(async ({ app, expect }) => {
  /*
   * However many people tried at once, and however many times a form was sent, one lamp makes at
   * most one order and the stock never goes below zero.
   */
  const books = Books.parse(await (await fetch(new URL("/stock.json", app.baseUrl))).json())

  expect(books.orders).toBeLessThanOrEqual(1)
  expect(books.stock).toBeGreaterThanOrEqual(0)
})
