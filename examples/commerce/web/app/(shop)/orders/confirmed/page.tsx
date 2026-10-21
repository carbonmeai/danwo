import Link from "next/link"

import { AutoRefresh } from "@/components/auto-refresh"
import { OrderCard } from "@/components/order-card"
import { Notice } from "@/components/ui"
import { api, Order, PaymentState } from "@/lib/api"

export const metadata = { title: "Order confirmed" }

type Props = { readonly searchParams: Promise<{ readonly session_id?: string }> }

/**
 * Where Stripe sends the customer after paying. The order is made by Stripe's webhook, which may
 * land a moment after the customer does, so until then the page says the payment is being
 * confirmed and looks again every second.
 */
export default async function Confirmed({ searchParams }: Props) {
  const { session_id: session } = await searchParams

  if (!session) return <Notice tone="danger">This link is missing its checkout.</Notice>

  const payment = await api(`/checkout/sessions/${encodeURIComponent(session)}`, PaymentState)

  if (payment.state !== "ordered")
    return (
      <div className="mx-auto max-w-lg">
        <AutoRefresh ms={1000} />
        <h1 className="text-[22px] font-semibold">
          {payment.state === "paid" ? "Confirming your order…" : "Waiting for your payment…"}
        </h1>
        <p className="mt-2 text-muted">This takes a few seconds. You can keep this page open.</p>
      </div>
    )

  const order = await api(`/orders/${payment.orderId}`, Order)

  return (
    <div className="mx-auto flex max-w-lg flex-col gap-6">
      <div>
        <h1 className="text-[22px] font-semibold">Thank you for your order</h1>
        <p className="mt-1 text-muted">
          A receipt is on its way to <strong className="text-ink">{order.email}</strong>.
        </p>
      </div>
      <OrderCard order={order} />
      <Link href="/" className="btn btn-secondary self-start">
        Keep shopping
      </Link>
    </div>
  )
}
