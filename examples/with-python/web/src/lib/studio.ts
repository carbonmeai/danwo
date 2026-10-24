/**
 * What the studio's API answers with, and how the pages show it. The API is the only thing that
 * reads the database or talks to Stripe and Resend; the site only calls it.
 */

/** One class on the week's timetable. */
export interface StudioClass {
  readonly slug: string
  readonly name: string
  readonly instructor: string
  readonly starts: string
  readonly minutes: number
  readonly description: string
  readonly price_cents: number
  readonly capacity: number
  readonly places_left: number
}

/** One booking, with its class and whether its confirmation email has gone out. */
export interface Booking {
  readonly id: number
  readonly number: string
  readonly email: string
  readonly amount_cents: number
  readonly confirmation: "sent" | "pending"
  readonly class: Pick<StudioClass, "slug" | "name" | "instructor" | "starts" | "minutes">
}

/** What became of a Checkout Session: its booking, or whether Stripe has the money yet. */
export interface CheckoutResult {
  readonly booking: Booking | null
  readonly payment: "paid" | "unpaid"
}

/** `1800` as `$18.00`. */
export function money(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`
}

/** How a class's places read on the timetable: `Full`, `1 place left`, `11 places left`. */
export function placesLeft(klass: Pick<StudioClass, "places_left">): string {
  if (klass.places_left <= 0) return "Full"

  return `${klass.places_left} ${klass.places_left === 1 ? "place" : "places"} left`
}

/** The badge a class's places get: red when full, amber when nearly. */
export function placesTone(klass: Pick<StudioClass, "places_left">): string {
  if (klass.places_left <= 0) return "badge-danger"

  return klass.places_left <= 3 ? "badge-warning" : "badge-success"
}
