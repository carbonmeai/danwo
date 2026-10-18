import { collectionData } from "../collection.ts"
import type { BachsContext } from "../context.ts"
import { paymentListItem, paymentObject } from "../formatters.ts"
import { listPage, notFound } from "../helpers.ts"

/** Payments: list (newest first, optionally by status) and retrieve one with how it was paid. */
export function paymentRoutes(context: BachsContext): void {
  const { app, bachs } = context

  app.get("/v1/payments", (c) => {
    const status = c.req.query("status_filter")
    const payments = bachs.payments
      .where((payment) => !status || payment.status === status)
      .toReversed()

    return c.json(listPage(c, payments.map(paymentListItem)))
  })

  app.get("/v1/payments/:id", (c) => {
    const payment = bachs.payments.get(c.req.param("id")) ?? notFound("Payment")

    return c.json({
      ...paymentObject(payment, bachs),
      payment_method_details: collectionData(context, payment)["payment_method_details"],
    })
  })
}
