import { resendInbox, test as base } from "@danwo/sdk"

import {
  CUSTOMER,
  DECLINED_CARD,
  expectBooksBalance,
  expectOneSessionPerBooking,
  pay,
  type StudioFixtures,
} from "./studio.ts"

const test = base.extend<StudioFixtures>()

test("browses the timetable", async ({ app, screen, expect }) => {
  await app.open("/")
  await expect(screen.getByRole("heading", { name: "This week's classes" })).toBeVisible()
  await expect(screen.getByRole("link", { name: /Spin sprint/ })).toContainText("Full")

  await screen.getByRole("link", { name: /Pottery wheel/ }).click()

  await expect(screen.getByRole("heading", { name: "Pottery wheel" })).toBeVisible()
  await expect(screen.getByTestId("class-price")).toHaveText("$45.00")
  await expect(screen.getByRole("button", { name: "Book and pay $45.00" })).toBeVisible()
}).invariant(async (fixtures) => {
  // Looking is not booking: nothing is paid, so nothing is owed.
  await expectBooksBalance(fixtures)
  fixtures.expect(await fixtures.sql("select id from bookings")).toHaveLength(0)
})

test("books a class and pays through Stripe Checkout", async ({ app, screen, expect }) => {
  await pay({ app, screen, expect }, { klass: "sunrise-flow", email: "sam@fernstudio.test" })

  await expect(screen.getByRole("heading", { name: "You're booked" })).toBeVisible()
  await expect(screen.getByTestId("booking-total")).toHaveText("$18.00")

  await app.open("/")
  await expect(screen.getByRole("link", { name: /Sunrise flow/ })).toContainText("11 places left")
}).invariant(async (fixtures) => {
  await expectBooksBalance(fixtures)
  await expectOneSessionPerBooking(fixtures)
})

test("a declined card shows Stripe's error and books nothing", async ({ app, screen, expect }) => {
  await pay(
    { app, screen, expect },
    { klass: "breathwork", email: "kit@fernstudio.test", card: DECLINED_CARD },
  )

  await expect(screen.getByRole("alert")).toHaveText("Your card was declined.")

  await app.open("/bookings?email=kit%40fernstudio.test")
  await expect(screen.getByText("No bookings yet")).toBeVisible()
}).invariant(async (fixtures) => {
  await expectBooksBalance(fixtures)
  fixtures.expect(await fixtures.sql("select id from bookings")).toHaveLength(0)
  fixtures.expect(resendInbox(fixtures.resend).list("kit@fernstudio.test")).toHaveLength(0)
})

test("lists my bookings", { session: "returning-customer" }, async ({ app, screen, expect }) => {
  await app.open("/")
  await screen.getByRole("link", { name: "My bookings" }).click()

  const row = screen.getByRole("row", { name: /Sunrise flow/ })

  await expect(row).toContainText("$18.00")
  await expect(row).toContainText("Sent")
}).invariant(async (fixtures) => {
  await expectBooksBalance(fixtures)
  fixtures.expect(await fixtures.sql("select email from bookings")).toEqual([{ email: CUSTOMER }])
})
