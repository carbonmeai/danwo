import { z } from "zod"

import { StatusBadge } from "@/components/order-card"
import { Empty, Notice, PageTitle } from "@/components/ui"
import { api, Order } from "@/lib/api"
import { money, when } from "@/lib/format"

export const metadata = { title: "Orders" }

type Props = {
  readonly searchParams: Promise<{ readonly refunded?: string; readonly error?: string }>
}

function Stat({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div className="card px-4 py-3">
      <p className="text-[12px] text-muted">{label}</p>
      <p className="mt-0.5 text-[18px] font-semibold">{value}</p>
    </div>
  )
}

function OrderRow({ order }: { readonly order: Order }) {
  const items = order.lines.reduce((sum, line) => sum + line.quantity, 0)

  return (
    <tr className="border-t border-line">
      <td className="px-4 py-2.5 font-medium">{order.number}</td>
      <td className="px-4 py-2.5 text-muted">{when(order.createdAt)}</td>
      <td className="px-4 py-2.5">{order.email}</td>
      <td className="px-4 py-2.5 text-muted">
        {items} {items === 1 ? "item" : "items"}
      </td>
      <td className="px-4 py-2.5 text-right tabular-nums">{money(order.totalCents)}</td>
      <td className="px-4 py-2.5">
        <StatusBadge status={order.status} />
      </td>
      <td className="px-4 py-2.5 text-right">
        {order.status === "refunded" ? null : (
          <form method="post" action={`/admin/orders/${order.id}/refund`}>
            <button
              type="submit"
              className="btn btn-secondary btn-sm"
              aria-label={`Refund order ${order.number}`}
            >
              Refund
            </button>
          </form>
        )}
      </td>
    </tr>
  )
}

export default async function AdminOrders({ searchParams }: Props) {
  const { refunded, error } = await searchParams
  const orders = await api("/admin/orders", z.array(Order))
  const paid = orders.filter((order) => order.status !== "refunded")

  return (
    <>
      <PageTitle title="Orders" />
      <div className="mb-6 grid grid-cols-3 gap-3">
        <Stat label="Orders" value={String(orders.length)} />
        <Stat
          label="Revenue"
          value={money(paid.reduce((sum, order) => sum + order.totalCents, 0))}
        />
        <Stat label="Refunded" value={String(orders.length - paid.length)} />
      </div>
      <div className="mb-4 empty:hidden">
        {refunded && <Notice tone="ok">Order {refunded} was refunded.</Notice>}
        {error && <Notice tone="danger">{error}</Notice>}
      </div>
      {orders.length === 0 ? (
        <Empty title="No orders yet">Orders show up here once a customer pays.</Empty>
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-[13px]">
            <thead className="bg-subtle text-left text-[12px] text-muted">
              <tr>
                <th className="px-4 py-2 font-medium">Order</th>
                <th className="px-4 py-2 font-medium">Placed</th>
                <th className="px-4 py-2 font-medium">Customer</th>
                <th className="px-4 py-2 font-medium">Items</th>
                <th className="px-4 py-2 text-right font-medium">Total</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {orders.map((order) => (
                <OrderRow key={order.id} order={order} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}
