import { read } from "#lib/server/api.ts"
import { rememberedEmail } from "#lib/server/customer.ts"
import type { Booking } from "#lib/studio.ts"

import type { PageServerLoad } from "./$types"

/** My bookings: the email asked about, or the one this browser booked with, and its bookings. */
export const load: PageServerLoad = async ({ url, cookies }) => {
  const email = (url.searchParams.get("email") ?? rememberedEmail(cookies)).trim().toLowerCase()
  const bookings = email
    ? await read<Booking[]>(`/bookings?email=${encodeURIComponent(email)}`)
    : []

  return { email, bookings, crumb: "My bookings" }
}
