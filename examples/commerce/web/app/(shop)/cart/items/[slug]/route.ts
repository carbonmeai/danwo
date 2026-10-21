/** The cart's "Update" and "Remove" buttons for one line. */
import { api, Cart } from "@/lib/api"
import { cartId, seeOther } from "@/lib/session"

type Context = { readonly params: Promise<{ readonly slug: string }> }

export async function POST(request: Request, { params }: Context): Promise<Response> {
  const { slug } = await params
  const form = await request.formData()
  const quantity = form.get("remove") ? 0 : Number(form.get("quantity") ?? 1)
  const id = await cartId()

  if (id)
    await api(`/carts/${id}/items/${encodeURIComponent(slug)}`, Cart, {
      method: "PUT",
      body: { quantity },
    })

  return seeOther("/cart")
}
