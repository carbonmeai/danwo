import { z } from "zod"

import { OrderCard } from "@/components/order-card"
import { Empty, PageTitle } from "@/components/ui"
import { api, Order } from "@/lib/api"
import { savedEmail } from "@/lib/session"

export const metadata = { title: "My orders" }

type Props = { readonly searchParams: Promise<{ readonly email?: string }> }

/** A guest's orders, found by the email they paid with (remembered from their last checkout). */
export default async function MyOrders({ searchParams }: Props) {
  const email = (await searchParams).email ?? (await savedEmail())
  const orders = email
    ? await api(`/orders?email=${encodeURIComponent(email)}`, z.array(Order))
    : []

  return (
    <div className="mx-auto max-w-2xl">
      <PageTitle title="My orders" />
      <form method="get" className="mb-6 flex items-end gap-3">
        <label className="flex flex-1 flex-col gap-1 text-sm text-muted">
          Email you paid with
          <input type="email" name="email" required defaultValue={email} className="input" />
        </label>
        <button type="submit" className="btn btn-secondary">
          Find orders
        </button>
      </form>
      {!email ? null : orders.length === 0 ? (
        <Empty title="No orders yet">Orders paid with {email} show up here.</Empty>
      ) : (
        <div className="flex flex-col gap-4">
          {orders.map((order) => (
            <OrderCard key={order.id} order={order} />
          ))}
        </div>
      )}
    </div>
  )
}
