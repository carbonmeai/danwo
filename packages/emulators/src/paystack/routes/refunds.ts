import type { Context } from "../../http.ts"
import { requireIntegration } from "../auth.ts"
import type { PaystackRouteContext } from "../context.ts"
import type { Transaction } from "../entities.ts"
import { refundObject } from "../formatters.ts"
import { amountOf, bodyOf, fail, nextId, ok, pageOf, text } from "../helpers.ts"
import { emitEvent } from "../signature.ts"
import { transactionsOf } from "./transactions.ts"

/** How long a refund stays pending before it is processed. */
const PROCESSED_AFTER_MS = 2000

/** Processes a refund on the clock: the money goes back, and a full refund reverses the transaction. */
function processLater(context: PaystackRouteContext, id: number): void {
  context.timer.setTimeout(() => {
    const { paystack, clock, outbox } = context
    const refund = paystack.refunds.get(String(id))

    if (refund?.status !== "pending") return

    const processed = paystack.refunds.change(String(id), {
      status: "processed",
      refunded_at: clock().toISOString(),
    })
    const transaction = paystack.transactions.where((t) => t.id === refund.transaction)[0]
    const refunded = paystack.refunds
      .where((r) => r.transaction === refund.transaction && r.status === "processed")
      .reduce((sum, r) => sum + r.amount, 0)

    if (transaction && refunded >= transaction.amount)
      paystack.transactions.change(transaction.reference, { status: "reversed" })

    emitEvent(outbox, "refund.processed", processed)
  }, PROCESSED_AFTER_MS)
}

/** How much of a transaction is already refunded or on its way back. */
function refundedSoFar(context: PaystackRouteContext, transaction: Transaction): number {
  return context.paystack.refunds
    .where((r) => r.transaction === transaction.id && r.status !== "failed")
    .reduce((sum, r) => sum + r.amount, 0)
}

/** Why a transaction cannot be refunded by `amount`; undefined when it can. */
function refundProblem(
  transaction: Transaction,
  amount: number,
  already: number,
): string | undefined {
  if (transaction.status !== "success") return "Transaction has not been paid"

  return amount <= 0 || already + amount > transaction.amount
    ? "Refund amount cannot be greater than transaction amount"
    : undefined
}

async function create(c: Context, context: PaystackRouteContext): Promise<Response> {
  const integration = requireIntegration(c, context.paystack)
  const fields = await bodyOf(c)
  const key = text(fields, "transaction") ?? ""
  const transaction = transactionsOf(context.paystack, integration).find(
    (t) => t.reference === key || String(t.id) === key,
  )

  if (transaction === undefined) return fail(c, 404, "Transaction not found")

  const already = refundedSoFar(context, transaction)
  const amount = amountOf(fields) ?? transaction.amount - already
  const problem = refundProblem(transaction, amount, already)

  if (problem !== undefined) return fail(c, 400, problem)

  const refund = context.paystack.refunds.add(
    refundObject({
      id: nextId(context.store),
      transaction,
      amount,
      customerNote: text(fields, "customer_note") ?? null,
      merchantNote: text(fields, "merchant_note") ?? null,
      integration,
      now: context.clock(),
    }),
    null,
  )

  processLater(context, refund.id)

  return ok(c, "Refund has been queued for processing", { ...refund, transaction })
}

/** Refunds of paid transactions, processed on the emulator's clock. */
export function refundRoutes(context: PaystackRouteContext): void {
  const { app, paystack } = context

  app.post("/refund", (c) => create(c, context))

  app.get("/refund", (c) => {
    const integration = requireIntegration(c, paystack)
    const { data, meta } = pageOf(
      c,
      paystack.refunds.where((r) => r.integration === integration.number),
    )

    return ok(c, "Refunds retrieved", data, { meta })
  })

  app.get("/refund/:id", (c) => {
    const refund = paystack.refunds.get(c.req.param("id"))

    return refund ? ok(c, "Refund retrieved", refund) : fail(c, 404, "Refund not found")
  })
}
