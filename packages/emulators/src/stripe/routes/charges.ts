import { escapeHtml, formatMoney, messagePage } from "../checkout-page.ts"
import type { StripeRouteContext } from "../context.ts"
import { listPage, noSuch } from "../helpers.ts"

/** Charges are created by payments; the API reads them, and `receipt_url` shows one. */
export function chargeRoutes({ app, objects }: StripeRouteContext): void {
  const { charges } = objects

  app.get("/v1/charges/:id", (c) => {
    const id = c.req.param("id")
    const charge = charges.get(id)

    return charge ? c.json(charge) : noSuch(c, "charge", id)
  })

  app.get("/v1/charges", (c) => {
    const intent = c.req.query("payment_intent")
    const customer = c.req.query("customer")

    return listPage(
      c,
      charges.where(
        (charge) =>
          (intent === undefined || charge.payment_intent === intent) &&
          (customer === undefined || charge.customer === customer),
      ),
      "/v1/charges",
    )
  })

  app.get("/receipts/:id", (c) => {
    const charge = charges.get(c.req.param("id"))

    if (!charge) return c.html(messagePage("Receipt not found", "There is no such receipt."), 404)

    return c.html(
      messagePage(
        "Receipt",
        `Paid ${formatMoney(charge.amount, charge.currency)}`,
        `<p data-testid="receipt-charge">${escapeHtml(charge.id)}</p>`,
      ),
    )
  })
}
