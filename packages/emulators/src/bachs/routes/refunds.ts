import { debit } from "../balance.ts"
import type { BachsContext } from "../context.ts"
import type { Payment, Refund } from "../entities.ts"
import { isRefundable, refundObject } from "../formatters.ts"
import {
  bachsId,
  BachsFailure,
  bodyOf,
  invalid,
  iso,
  later,
  listPage,
  minorOf,
  money,
  notFound,
  text,
} from "../helpers.ts"
import { SETTLE_OUT_MS } from "../money-out.ts"

/** The payment a refund is for, refusing one that cannot take a refund. */
function refundablePayment(context: BachsContext, chargeId: string | undefined): Payment {
  if (!chargeId)
    invalid("Missing required field(s): charge_id", {
      field: "charge_id",
      message: "Field required",
      type: "missing",
    })

  const payment = context.bachs.payments.get(chargeId) ?? notFound("Charge")

  if (
    context.bachs.refunds.where(
      (refund) => refund.chargeId === payment.id && refund.status !== "failed",
    ).length > 0
  )
    throw new BachsFailure(409, "CONFLICT", "A refund already exists for this charge")
  if (payment.method === "NGN_BANK_TRANSFER")
    throw new BachsFailure(400, "BAD_REQUEST", "Refunds are not supported for this charge")
  if (!isRefundable(payment, context.bachs))
    throw new BachsFailure(
      400,
      "BAD_REQUEST",
      `Charge is not refundable in status ${payment.status}`,
    )

  return payment
}

/** The amount to refund: the whole payment, or a partial amount no larger than it. */
function requestedAmount(payment: Payment, value: unknown): number {
  if (value === undefined || value === null) return payment.amount

  const amount = minorOf(value)

  if (amount === undefined || amount <= 0) invalid("amount must be a positive decimal string")
  if (amount > payment.amount)
    throw new BachsFailure(
      400,
      "BAD_REQUEST",
      `Refund amount ${money(amount)} exceeds refundable balance`,
    )

  return amount
}

/** A refund from a create request: validated, its balance reserved, before it is stored. */
function newRefund(context: BachsContext, body: Record<string, unknown>): Refund {
  const reference = text(body, "reference")

  if (!reference)
    invalid("Missing required field(s): reference", {
      field: "reference",
      message: "Field required",
      type: "missing",
    })
  if (context.bachs.refunds.where((refund) => refund.reference === reference).length > 0)
    throw new BachsFailure(409, "CONFLICT", "Refund reference already exists")

  const payment = refundablePayment(context, text(body, "charge_id"))
  const requested = requestedAmount(payment, body["amount"])

  debit(context.bachs, payment.currency, requested, "refund")

  const now = context.clock()

  return {
    id: bachsId("rfnd", 20),
    chargeId: payment.id,
    reference,
    status: "processing",
    requested,
    currency: payment.currency,
    reason: text(body, "reason") ?? null,
    feeBearer: body["fee_bearer"] === "customer" ? "customer" : "org",
    outcome: body["simulated_outcome"] === "failed" ? "failed" : "success",
    idempotencyKey: text(body, "idempotency_key") ?? null,
    settlesAt: iso(later(now, SETTLE_OUT_MS)),
    createdAt: iso(now),
    updatedAt: iso(now),
    completedAt: null,
  }
}

/** A refund as the API answers it: the refunded amount only once it succeeded. */
function answer(refund: Refund) {
  return refundObject(refund, refund.status === "success")
}

/** Refunds: create one against a payment (settled a moment later), retrieve, list, find by payment. */
export function refundRoutes(context: BachsContext): void {
  const { app, bachs } = context

  app.post("/v1/refunds", async (c) => {
    const body = await bodyOf(c)
    const key = text(body, "idempotency_key")
    const repeat = key
      ? bachs.refunds.where(
          (refund) => refund.idempotencyKey === key && refund.chargeId === text(body, "charge_id"),
        )[0]
      : undefined

    if (repeat) return c.json(answer(repeat), 200)

    const refund = bachs.refunds.add(newRefund(context, body), null)

    context.events.emit("refund.created", answer(refund))
    context.wakeAt(new Date(refund.settlesAt ?? refund.createdAt))

    return c.json(answer(refund), 201)
  })

  app.get("/v1/refunds/by-charge/:id", (c) => {
    const refund =
      bachs.refunds.where((r) => r.chargeId === c.req.param("id")).at(-1) ?? notFound("Refund")

    return c.json(answer(refund))
  })

  app.get("/v1/refunds/:id", (c) =>
    c.json(answer(bachs.refunds.get(c.req.param("id")) ?? notFound("Refund"))),
  )

  app.get("/v1/refunds", (c) => c.json(listPage(c, bachs.refunds.all().toReversed().map(answer))))
}
