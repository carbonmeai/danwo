import { fail, redirect } from "@sveltejs/kit"

import { call, messageOf, read } from "#lib/server/api.ts"
import { rememberedEmail, rememberEmail } from "#lib/server/customer.ts"
import type { StudioClass } from "#lib/studio.ts"

import type { Actions, PageServerLoad } from "./$types"

/** Where Stripe's hosted payment page is: the one site a booking may send the customer to. */
const STRIPE_CHECKOUT = "https://checkout.stripe.com"

/** A class's page: the class from the API, and the email this browser booked with last. */
export const load: PageServerLoad = async ({ params, cookies }) => {
  const klass = await read<StudioClass>(`/classes/${encodeURIComponent(params.slug)}`)

  return { klass, email: rememberedEmail(cookies), crumb: klass.name }
}

export const actions: Actions = {
  /**
   * Book and pay: the API starts Stripe Checkout for one place, and the customer goes on to
   * Stripe's page. Pressing it twice gets the same Checkout Session back from the API.
   */
  async book({ params, request, cookies, url }) {
    const email = String((await request.formData()).get("email") ?? "").trim()
    const answer = await call<{ readonly url: string } | { readonly error: string }>(
      `/classes/${encodeURIComponent(params.slug)}/checkout`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email }),
      },
    )

    if (!answer.ok || !("url" in answer.body))
      return fail(answer.ok ? 502 : answer.status, { email, error: messageOf(answer.body) })

    rememberEmail(cookies, url, email.toLowerCase())
    redirect(303, answer.body.url, { external: [STRIPE_CHECKOUT] })
  },
}
