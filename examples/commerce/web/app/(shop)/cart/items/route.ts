/** The product page's "Add to cart": adds the item, then shows the cart. */
import { api, ApiError, Cart } from "@/lib/api"
import { ensureCartId, seeOther } from "@/lib/session"

export async function POST(request: Request): Promise<Response> {
  const form = await request.formData()
  const slug = String(form.get("slug") ?? "")
  const quantity = Number(form.get("quantity") ?? 1)
  const id = await ensureCartId()

  try {
    await api(`/carts/${id}/items`, Cart, { method: "POST", body: { slug, quantity } })
  } catch (error) {
    const message = error instanceof ApiError ? error.message : "Could not add that to your cart."

    return seeOther(`/cart?error=${encodeURIComponent(message)}`)
  }

  return seeOther("/cart")
}
