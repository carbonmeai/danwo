/**
 * Transactions: verifying one by id or by `tx_ref`, listing with filters, fees, the timeline,
 * resending a transaction's webhook, and refunds.
 */
import type { Context } from "../../http.ts"
import type { FlutterwaveRouteContext } from "../context.ts"
import type { Refund, Transaction } from "../entities.ts"
import type { FlutterwaveEvents } from "../events.ts"
import {
  ACCOUNT_ID,
  amountOf,
  appFee,
  failure,
  isoTime,
  jsonBody,
  money,
  nextId,
  pageOf,
  success,
  text,
} from "../helpers.ts"

/** A transaction by the `:id` in the path. */
function byId(context: FlutterwaveRouteContext, c: Context): Transaction | undefined {
  return context.flutterwave.transactions.get(c.req.param("id"))
}

/** Whether a transaction matches the list filters in the query. */
function matchesQuery(c: Context, transaction: Transaction): boolean {
  const from = c.req.query("from")
  const to = c.req.query("to")
  const created = transaction.created_at.slice(0, 10)
  const equals: [string | undefined, string][] = [
    [c.req.query("status"), transaction.status],
    [c.req.query("tx_ref"), transaction.tx_ref],
    [c.req.query("customer_email"), transaction.customer.email],
    [c.req.query("currency")?.toUpperCase(), transaction.currency],
  ]

  return (
    equals.every(([wanted, actual]) => wanted === undefined || wanted === actual) &&
    (from === undefined || created >= from) &&
    (to === undefined || created <= to)
  )
}

function refundRoutes(context: FlutterwaveRouteContext): void {
  const { app, flutterwave } = context

  app.post("/v3/transactions/:id/refund", async (c) => {
    const transaction = byId(context, c)
    const extra = transaction && flutterwave.transactions.extra(String(transaction.id))

    if (transaction === undefined || extra === undefined)
      return failure(c, 400, "No transaction was found for this id")
    if (transaction.status !== "successful")
      return failure(c, 400, "Only successful transactions can be refunded")

    const body = await jsonBody(c)
    const left = money(transaction.amount - extra.refunded)
    const amount = amountOf(body, "amount") ?? left

    if (amount <= 0 || amount > left)
      return failure(c, 400, `Refund amount must be between 0 and ${left} ${transaction.currency}`)

    const refund: Refund = {
      id: nextId(context.store),
      account_id: ACCOUNT_ID,
      tx_id: transaction.id,
      flw_ref: `URF_${context.clock().getTime()}_${nextId(context.store)}`,
      wallet_id: ACCOUNT_ID + 1,
      amount_refunded: amount,
      status: "completed",
      destination: "payment_source",
      meta: { source: "availablebalance" },
      comments: text(body, "comments") ?? "",
      created_at: isoTime(context.clock()),
    }

    flutterwave.refunds.add(refund, null)
    flutterwave.transactions.setExtra(String(transaction.id), {
      ...extra,
      refunded: money(extra.refunded + amount),
    })

    return success(c, "Transaction refund initiated", refund)
  })

  app.get("/v3/refunds/:id", (c) => {
    const refund = flutterwave.refunds.get(c.req.param("id"))

    return refund ? success(c, "Refund fetched", refund) : failure(c, 404, "Refund not found")
  })

  app.get("/v3/refunds", (c) => {
    const page = pageOf(c, flutterwave.refunds.all().toReversed())

    return success(c, "Refunds fetched", page.data, page.meta)
  })
}

export function transactionRoutes(
  context: FlutterwaveRouteContext,
  events: FlutterwaveEvents,
): void {
  const { app, flutterwave } = context

  app.get("/v3/transactions/verify_by_reference", (c) => {
    const reference = c.req.query("tx_ref") ?? ""
    const found = flutterwave.transactions.where((transaction) => transaction.tx_ref === reference)
    const latest = found.at(-1)

    return latest
      ? success(c, "Transaction fetched successfully", latest)
      : failure(c, 400, "No transaction was found for this tx_ref")
  })

  app.get("/v3/transactions/fee", (c) => {
    const amount = Number(c.req.query("amount") ?? "0")
    const fee = appFee(amount)

    return success(c, "Charged fee", {
      charge_amount: money(amount + fee),
      fee,
      merchant_fee: 0,
      flutterwave_fee: fee,
      stamp_duty_fee: 0,
      currency: (c.req.query("currency") ?? "NGN").toUpperCase(),
    })
  })

  app.get("/v3/transactions/:id/verify", (c) => {
    const transaction = byId(context, c)

    return transaction
      ? success(c, "Transaction fetched successfully", transaction)
      : failure(c, 400, "No transaction was found for this id")
  })

  app.get("/v3/transactions/:id/events", (c) => {
    const transaction = byId(context, c)
    const extra = transaction && flutterwave.transactions.extra(String(transaction.id))

    return extra
      ? success(c, "Transaction events fetched", extra.events)
      : failure(c, 400, "No transaction was found for this id")
  })

  app.post("/v3/transactions/:id/resend-hook", (c) => {
    const transaction = byId(context, c)

    if (transaction === undefined) return failure(c, 400, "No transaction was found for this id")

    events.charged(transaction)

    return success(c, "hook sent", "hook sent")
  })

  app.get("/v3/transactions", (c) => {
    const matching = flutterwave.transactions
      .all()
      .filter((transaction) => matchesQuery(c, transaction))
      .toReversed()
    const page = pageOf(c, matching)

    return success(c, "Transactions fetched", page.data, page.meta)
  })

  refundRoutes(context)
}
