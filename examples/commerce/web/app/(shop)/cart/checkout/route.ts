/**
 * The cart's "Checkout": asks the API for a Stripe Checkout Session and sends the browser to
 * Stripe's payment page. Pressing it twice gets the same session, not a second one.
 */
import { z } from "zod"

import { api, ApiError } from "@/lib/api"
import { cartId, saveEmail, seeOther } from "@/lib/session"

const Started = z.object({ url: z.string() })

/** This storefront's address as the browser sees it, for Stripe to send the customer back to. */
function originOf(request: Request): string {
  if (process.env.SHOP_URL) return process.env.SHOP_URL

  const host = request.headers.get("host") ?? "127.0.0.1:3000"

  return `http://${host}`
}

export async function POST(request: Request): Promise<Response> {
  const form = await request.formData()
  const email = String(form.get("email") ?? "").trim()
  const id = await cartId()

  if (!id) return seeOther("/cart")

  await saveEmail(email)

  try {
    const { url } = await api(`/carts/${id}/checkout`, Started, {
      method: "POST",
      body: { email, origin: originOf(request) },
    })

    return seeOther(url)
  } catch (error) {
    const message =
      error instanceof ApiError && error.status === 409
        ? error.message
        : "We couldn't start checkout just now. Please try again."

    return seeOther(`/cart?error=${encodeURIComponent(message)}`)
  }
}
