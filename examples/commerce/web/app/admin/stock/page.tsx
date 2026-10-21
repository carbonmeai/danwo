import { z } from "zod"

import { Badge, PageTitle } from "@/components/ui"
import { api, StockRow } from "@/lib/api"
import { money } from "@/lib/format"

export const metadata = { title: "Stock" }

/** How full a product's shelf is, out of what it started with before any sold. */
function Level({ stock, sold }: { readonly stock: number; readonly sold: number }) {
  const start = Math.max(stock + sold, 1)
  const tone = stock === 0 ? "bg-danger" : stock <= 3 ? "bg-warn" : "bg-accent"

  return (
    <div className="h-1.5 w-32 overflow-hidden rounded-full bg-subtle" aria-hidden="true">
      <div className={`h-full ${tone}`} style={{ width: `${(100 * stock) / start}%` }} />
    </div>
  )
}

export default async function AdminStock() {
  const rows = await api("/admin/stock", z.array(StockRow))

  return (
    <>
      <PageTitle title="Stock" />
      <div className="card overflow-hidden">
        <table className="w-full text-[13px]">
          <thead className="bg-subtle text-left text-[12px] text-muted">
            <tr>
              <th className="px-4 py-2 font-medium">Product</th>
              <th className="px-4 py-2 font-medium">Category</th>
              <th className="px-4 py-2 text-right font-medium">Price</th>
              <th className="px-4 py-2 text-right font-medium">Sold</th>
              <th className="px-4 py-2 text-right font-medium">In stock</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.slug} className="border-t border-line">
                <td className="px-4 py-2.5 font-medium">{row.name}</td>
                <td className="px-4 py-2.5 capitalize text-muted">{row.category}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{money(row.priceCents)}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{row.sold}</td>
                <td
                  className="px-4 py-2.5 text-right tabular-nums"
                  data-testid={`stock-${row.slug}`}
                >
                  {row.stock}
                </td>
                <td className="px-4 py-2.5">
                  <div className="flex items-center justify-end gap-3">
                    {row.stock === 0 && <Badge tone="danger">Sold out</Badge>}
                    <Level stock={row.stock} sold={row.sold} />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}
