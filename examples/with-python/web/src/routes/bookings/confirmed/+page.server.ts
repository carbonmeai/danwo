import { error } from "@sveltejs/kit"

import { read } from "#lib/server/api.ts"
import type { CheckoutResult } from "#lib/studio.ts"

import type { PageServerLoad } from "./$types"

/**
 * Where Stripe sends the customer after paying. Stripe's webhook makes the booking, and it may
 * land a moment after the customer does: the page then asks again from the browser.
 */
export const load: PageServerLoad = async ({ url }) => {
  const sessionId = url.searchParams.get("session_id") ?? ""

  if (!sessionId) error(404, "No such booking.")

  const result = await read<CheckoutResult>(`/checkout/${encodeURIComponent(sessionId)}`)

  return { sessionId, result, crumb: result.booking ? "Booking confirmed" : "Booking" }
}
