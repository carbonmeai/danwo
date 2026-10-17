/**
 * The shop's books, read two ways for invariants: the credits the shop granted a user, and the
 * credits Stripe took payment for. However a purchase went, the two must agree.
 */
import { z } from "zod"

const PaidSessions = z.object({
  data: z.array(
    z.object({
      client_reference_id: z.string().nullable(),
      metadata: z.record(z.string(), z.string()).nullable(),
    }),
  ),
})
const Credits = z.object({ credits: z.number() })

/** Anything that answers Stripe's API: the Stripe emulator. */
export interface StripeApi {
  fetch(request: Request): Promise<Response>
}

/** The credits the shop at `baseUrl` granted `user`. */
export async function grantedCredits(baseUrl: string, user: string): Promise<number> {
  const res = await fetch(`${baseUrl}/credits?user=${encodeURIComponent(user)}`)

  return Credits.parse(await res.json()).credits
}

/** Credits Stripe took payment for: the paid checkout sessions of `user`. */
export async function paidCredits(stripe: StripeApi, user: string): Promise<number> {
  const res = await stripe.fetch(
    new Request("https://api.stripe.com/v1/checkout/sessions?payment_status=paid&limit=100", {
      headers: { authorization: "Bearer sk_test_danwo_example" },
    }),
  )
  const { data } = PaidSessions.parse(await res.json())

  return data
    .filter((session) => session.client_reference_id === user)
    .reduce((sum, session) => sum + Number(session.metadata?.credits ?? 0), 0)
}
