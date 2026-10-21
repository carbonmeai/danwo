import { z } from "zod"

import { AdminTopbar } from "@/components/admin-nav"
import { Badge, PageTitle } from "@/components/ui"
import { api, StockRow } from "@/lib/api"
import { money } from "@/lib/format"

export const metadata = { title: "Stock" }

/** How full a product's shelf is, out of what it started with before any sold. */
function Level({ stock, sold }: { readonly stock: number; readonly sold: number }) {
  const start = Math.max(stock + sold, 1)
  const tone = stock === 0 ? "bg-danger" : stock <= 3 ? "bg-warning" : "bg-success"

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
      <AdminTopbar page="Stock" />
      <div className="shell-content">
        <PageTitle title="Stock" />
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Product</th>
                <th>Category</th>
                <th className="num">Price</th>
                <th className="num">Sold</th>
                <th className="num">In stock</th>
                <th aria-label="Level" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.slug}>
                  <td className="font-medium">{row.name}</td>
                  <td className="muted capitalize">{row.category}</td>
                  <td className="num">{money(row.priceCents)}</td>
                  <td className="num">{row.sold}</td>
                  <td className="num" data-testid={`stock-${row.slug}`}>
                    {row.stock}
                  </td>
                  <td>
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
      </div>
    </>
  )
}
