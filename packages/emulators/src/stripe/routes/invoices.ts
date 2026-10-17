import { escapeHtml, formatMoney, messagePage } from "../checkout-page.ts"
import type { StripeRouteContext } from "../context.ts"
import { listPage, noSuch } from "../helpers.ts"

/** Invoices are made by Checkout; the API reads them, and `hosted_invoice_url` shows one. */
export function invoiceRoutes({ app, objects }: StripeRouteContext): void {
  const { invoices } = objects

  app.get("/v1/invoices/:id", (c) => {
    const id = c.req.param("id")
    const invoice = invoices.get(id)

    return invoice ? c.json(invoice) : noSuch(c, "invoice", id)
  })

  app.get("/v1/invoices", (c) => {
    const customer = c.req.query("customer")
    const status = c.req.query("status")

    return listPage(
      c,
      invoices.where(
        (invoice) =>
          (customer === undefined || invoice.customer === customer) &&
          (status === undefined || invoice.status === status),
      ),
      "/v1/invoices",
    )
  })

  app.get("/invoices/:id", (c) => {
    const invoice = invoices.get(c.req.param("id"))

    if (!invoice || invoice.status === "draft")
      return c.html(messagePage("Invoice not found", "There is no such invoice."), 404)

    const paid = invoice.status === "paid"
    const amount = formatMoney(paid ? invoice.amount_paid : invoice.amount_due, invoice.currency)

    return c.html(
      messagePage(
        `Invoice ${invoice.number ?? invoice.id}`,
        paid ? `Paid ${amount}` : `Amount due ${amount}`,
        `<p data-testid="invoice-status">${escapeHtml(invoice.status ?? "")}</p>`,
      ),
    )
  })
}
