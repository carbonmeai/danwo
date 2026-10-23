/**
 * What the studio's tests share: booking a class through the app and Stripe's hosted page, and
 * the invariants. Each invariant reads one fact from two sides, the app's database and the
 * provider's emulator, and must hold however a trial went: paid, declined, retried or faulted.
 */
import {
  type DanwoFixtures,
  type Emulator,
  type InboxEmail,
  type ResendFixtures,
  resendInbox,
  type StripeFixtures,
  z,
} from "@danwo/sdk"

import type { Sql } from "./db.ts"
import { CLASSES } from "./environment.ts"

/** Not a real key: the emulators accept any well-formed one. */
export const STRIPE_SECRET_KEY = "sk_test_fern_studio"

/** The returning customer's email. */
export const CUSTOMER = "ada@fernstudio.test"

/** Stripe's declining test card. */
export const DECLINED_CARD = "4000 0000 0000 0002"

/** What every studio test receives: the emulators, and SQL on this worker's database. */
export type StudioFixtures = StripeFixtures & ResendFixtures & { readonly sql: Sql }

type Driving = Pick<DanwoFixtures, "app" | "screen" | "expect">

/**
 * Books a place in `booking.klass` as `booking.email`: the class's page, then Stripe's page,
 * paying with `card` (Stripe's Visa test card unless given). It stops once Pay is pressed.
 */
export async function pay(
  { app, screen, expect }: Driving,
  booking: { readonly klass: string; readonly email: string; readonly card?: string },
): Promise<void> {
  await app.open(`/classes/${booking.klass}`)
  await screen.getByLabel("Email for your confirmation").fill(booking.email)
  await screen.getByRole("button", { name: /^Book and pay/ }).click()
  await expect(screen.getByTestId("checkout-total")).toBeVisible()
  if (booking.card) await screen.getByLabel("Card number").fill(booking.card)
  await screen.getByTestId("checkout-pay").click()
}

/** `pay`, then waits for the confirmation. */
export async function book(
  fixtures: Driving,
  booking: { readonly klass: string; readonly email: string },
): Promise<void> {
  await pay(fixtures, booking)
  await fixtures
    .expect(fixtures.screen.getByRole("heading", { name: "You're booked" }))
    .toBeVisible()
}

/** The number a customer sees for a booking. */
export function bookingNumber(id: number): string {
  return `FS-${1000 + id}`
}

const Sessions = z.object({
  data: z.array(
    z.object({
      id: z.string(),
      client_reference_id: z.string().nullable(),
      payment_status: z.string(),
      amount_total: z.number().nullable(),
    }),
  ),
})

/** Every Checkout Session, read from the emulator the way the app's own client would. */
async function checkoutSessions(stripe: Emulator) {
  const res = await stripe.fetch(
    new Request("https://api.stripe.com/v1/checkout/sessions?limit=100", {
      headers: { authorization: `Bearer ${STRIPE_SECRET_KEY}` },
    }),
  )

  return Sessions.parse(await res.json()).data
}

interface BookingRow {
  readonly id: number
  readonly checkout_session_id: string
  readonly email: string
  readonly amount_cents: number
  readonly slug: string
}

/** The app's bookings, each with its class. */
function bookingsOf(sql: Sql): Promise<BookingRow[]> {
  return sql<BookingRow>(
    `select b.id, b.checkout_session_id, b.email, b.amount_cents, c.slug
       from bookings b join classes c on c.id = b.class_id order by b.id`,
  )
}

/** The confirmations Resend accepted, waiting a little for any still being retried. */
async function confirmationsFor(
  resend: Emulator,
  bookings: readonly BookingRow[],
): Promise<InboxEmail[]> {
  const deadline = Date.now() + 20_000
  const confirmations = () =>
    resendInbox(resend)
      .list()
      .filter((email) => email.subject.startsWith("You're booked"))

  while (confirmations().length < bookings.length && Date.now() < deadline)
    await new Promise((resolve) => setTimeout(resolve, 200))

  return confirmations()
}

/**
 * The studio's books balance with Stripe's and Resend's:
 * - exactly one booking per paid Checkout Session, and none for an unpaid one;
 * - each booking's amount is what Stripe charged, and the class's price;
 * - each class's places taken are its bookings, once each;
 * - exactly one confirmation email per booking, to the address that paid.
 */
export async function expectBooksBalance({
  sql,
  stripe,
  resend,
  expect,
}: StudioFixtures & Pick<DanwoFixtures, "expect">): Promise<void> {
  const bookings = await bookingsOf(sql)
  const paid = (await checkoutSessions(stripe)).filter((s) => s.payment_status === "paid")

  expect(
    bookings.map((booking) => booking.checkout_session_id).toSorted(),
    "one booking per paid Checkout Session",
  ).toEqual(paid.map((session) => session.id).toSorted())

  for (const booking of bookings) {
    const session = paid.find((s) => s.id === booking.checkout_session_id)
    const price = CLASSES.find((klass) => klass.slug === booking.slug)?.priceCents

    expect(booking.amount_cents, `${bookingNumber(booking.id)} is what Stripe charged`).toBe(
      session?.amount_total,
    )
    expect(booking.amount_cents, `${bookingNumber(booking.id)} is the class's price`).toBe(price)
  }

  const places = await sql<{ slug: string; booked: number; bookings: number }>(
    `select c.slug, c.booked,
            (select count(*) from bookings b where b.class_id = c.id)::int as bookings
       from classes c`,
  )

  expect(places).toHaveLength(CLASSES.length)
  for (const klass of places)
    expect(klass.booked, `${klass.slug}: a place taken once per booking`).toBe(klass.bookings)

  const confirmations = await confirmationsFor(resend, bookings)

  expect(confirmations, "one confirmation per booking").toHaveLength(bookings.length)
  for (const booking of bookings)
    expect(
      confirmations.filter(
        (email) =>
          email.subject.endsWith(`(${bookingNumber(booking.id)})`) &&
          email.to.includes(booking.email),
      ),
      `one confirmation for ${bookingNumber(booking.id)}`,
    ).toHaveLength(1)
}

/**
 * One Checkout Session per class and customer: a double-click, a retried request or a retry after
 * a lost answer must get the same session back, never start a second one the customer could pay.
 */
export async function expectOneSessionPerBooking({
  stripe,
  expect,
}: StudioFixtures & Pick<DanwoFixtures, "expect">): Promise<void> {
  const keys = (await checkoutSessions(stripe)).map(
    (session) => `${session.client_reference_id} ${session.amount_total}`,
  )

  expect(keys, "one Checkout Session per class and customer").toEqual([...new Set(keys)])
}
