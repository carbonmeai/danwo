/** The orders table's "Refund" button: refunds the order in full through the API. */
import { z } from "zod"

import { api, ApiError, Order } from "@/lib/api"
import { seeOther } from "@/lib/session"

type Context = { readonly params: Promise<{ readonly id: string }> }

export async function POST(_request: Request, { params }: Context): Promise<Response> {
  const { id } = await params

  try {
    await api(`/admin/orders/${encodeURIComponent(id)}/refund`, z.object({ status: z.string() }), {
      method: "POST",
    })
    const order = await api(`/orders/${encodeURIComponent(id)}`, Order)

    return seeOther(`/admin/orders?refunded=${encodeURIComponent(order.number)}`)
  } catch (error) {
    const message = error instanceof ApiError ? error.message : "The refund did not go through."

    return seeOther(`/admin/orders?error=${encodeURIComponent(message)}`)
  }
}
