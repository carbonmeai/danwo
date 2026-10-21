import { Badge } from "@/components/ui"
import type { Order } from "@/lib/api"
import { money, STATUS_LABEL, when } from "@/lib/format"

const TONE = { paid: "ok", refunding: "warn", refunded: "neutral" } as const

export function StatusBadge({ status }: { readonly status: Order["status"] }) {
  return <Badge tone={TONE[status]}>{STATUS_LABEL[status]}</Badge>
}

/** One order with its lines, as the customer sees it. */
export function OrderCard({ order }: { readonly order: Order }) {
  return (
    <article aria-label={`Order ${order.number}`} className="card p-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold" data-testid="order-number">
            Order {order.number}
          </h2>
          <p className="text-[13px] text-muted">{when(order.createdAt)}</p>
        </div>
        <StatusBadge status={order.status} />
      </header>
      <ul className="mt-4 divide-y divide-line border-y border-line text-[13px]">
        {order.lines.map((line) => (
          <li key={line.name} className="flex justify-between py-2">
            <span>
              {line.quantity} × {line.name}
            </span>
            <span>{money(line.unitCents * line.quantity)}</span>
          </li>
        ))}
      </ul>
      <p className="mt-3 flex justify-between font-medium">
        <span>Total</span>
        <span data-testid="order-total">{money(order.totalCents)}</span>
      </p>
    </article>
  )
}
