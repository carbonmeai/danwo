import { z } from "zod"

import { AdminTopbar } from "@/components/admin-nav"
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
    <div className="card stat px-4 py-3">
      <p className="stat-label">{label}</p>
      <p className="stat-value">{value}</p>
    </div>
  )
}

function OrderRow({ order }: { readonly order: Order }) {
  const items = order.lines.reduce((sum, line) => sum + line.quantity, 0)

  return (
    <tr>
      <td className="font-medium">{order.number}</td>
      <td className="muted">{when(order.createdAt)}</td>
      <td>{order.email}</td>
      <td className="muted">
        {items} {items === 1 ? "item" : "items"}
      </td>
      <td className="num">{money(order.totalCents)}</td>
      <td>
        <StatusBadge status={order.status} />
      </td>
      <td className="num">
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
      <AdminTopbar page="Orders" />
      <div className="shell-content">
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
          {refunded && <Notice tone="success">Order {refunded} was refunded.</Notice>}
          {error && <Notice tone="danger">{error}</Notice>}
        </div>
        {orders.length === 0 ? (
          <Empty title="No orders yet">Orders show up here once a customer pays.</Empty>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Order</th>
                  <th>Placed</th>
                  <th>Customer</th>
                  <th>Items</th>
                  <th className="num">Total</th>
                  <th>Status</th>
                  <th aria-label="Actions" />
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
      </div>
    </>
  )
}
