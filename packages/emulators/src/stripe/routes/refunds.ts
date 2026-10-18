import type { Context } from "../../http.ts"
import { isOneOf } from "../../json.ts"
import type { StripeRouteContext } from "../context.ts"
import type { Charge, Refund } from "../entities.ts"
import {
  badParam,
  integer,
  listPage,
  metadataOf,
  newId,
  noSuch,
  readParams,
  stripeError,
  text,
  unix,
} from "../helpers.ts"

type Reason = "duplicate" | "fraudulent" | "requested_by_customer"

const REASONS: readonly Reason[] = ["duplicate", "fraudulent", "requested_by_customer"]

/** The charge a refund request names: directly, or as a payment intent's latest charge. */
function chargeFor(
  context: StripeRouteContext,
  params: Record<string, unknown>,
): Charge | undefined {
  const { charges, paymentIntents } = context.objects
  const charge = text(params["charge"])

  if (charge !== undefined) return charges.get(charge)

  const intent = paymentIntents.get(text(params["payment_intent"]) ?? "")
  const latest = intent?.latest_charge

  return typeof latest === "string" ? charges.get(latest) : undefined
}

function refundObject(
  context: StripeRouteContext,
  charge: Charge,
  amount: number,
  params: Record<string, unknown>,
): Refund {
  const reason = params["reason"]

  return {
    id: newId("re"),
    object: "refund",
    amount,
    balance_transaction: null,
    charge: charge.id,
    created: unix(context.clock()),
    currency: charge.currency,
    customer: charge.customer,
    customer_account: null,
    metadata: metadataOf(params["metadata"]) ?? {},
    payment_intent: typeof charge.payment_intent === "string" ? charge.payment_intent : null,
    payment_method: typeof charge.payment_method === "string" ? charge.payment_method : null,
    reason: isOneOf(REASONS, reason) ? reason : null,
    receipt_number: null,
    source_transfer_reversal: null,
    status: "succeeded",
    transfer_reversal: null,
  }
}

/** The 404 for a refund whose charge or payment intent does not exist. */
function missingTarget(c: Context, params: Record<string, unknown>): Response {
  return params["charge"] === undefined
    ? noSuch(c, "payment_intent", text(params["payment_intent"]) ?? "", "payment_intent")
    : noSuch(c, "charge", text(params["charge"]) ?? "", "charge")
}

/** Why `amount` cannot be refunded from `charge`, as Stripe answers it, or undefined when it can. */
function refundProblem(c: Context, charge: Charge, amount: number): Response | undefined {
  const left = charge.amount - charge.amount_refunded

  if (left <= 0)
    return stripeError(
      c,
      400,
      "invalid_request_error",
      `Charge ${charge.id} has already been refunded.`,
      "charge_already_refunded",
    )

  if (amount > 0 && amount <= left) return undefined

  return stripeError(
    c,
    400,
    "invalid_request_error",
    `Refund amount (${amount}) is greater than unrefunded amount on charge (${left})`,
    "amount_too_large",
    "amount",
  )
}

async function createRefund(context: StripeRouteContext, c: Context): Promise<Response> {
  const params = await readParams(c)

  if (params["charge"] === undefined && params["payment_intent"] === undefined)
    return badParam(c, "charge")

  const charge = chargeFor(context, params)

  if (charge === undefined) return missingTarget(c, params)

  const amount = integer(params["amount"]) ?? charge.amount - charge.amount_refunded
  const problem = refundProblem(c, charge, amount)

  if (problem) return problem

  const refund = context.objects.refunds.add(refundObject(context, charge, amount, params), null)
  const refunded = context.objects.charges.change(charge.id, {
    amount_refunded: charge.amount_refunded + amount,
    refunded: charge.amount_refunded + amount >= charge.amount,
  })

  context.events.emit("refund.created", refund)
  if (refunded) context.events.emit("charge.refunded", refunded)

  return c.json(refund)
}

/** Refunds of captured charges, created by the API and settled at once as `succeeded`. */
export function refundRoutes(context: StripeRouteContext): void {
  const { app, objects } = context

  app.post("/v1/refunds", (c) => createRefund(context, c))

  app.get("/v1/refunds/:id", (c) => {
    const id = c.req.param("id")
    const refund = objects.refunds.get(id)

    return refund ? c.json(refund) : noSuch(c, "refund", id)
  })

  app.get("/v1/refunds", (c) => {
    const charge = c.req.query("charge")
    const intent = c.req.query("payment_intent")

    return listPage(
      c,
      objects.refunds.where(
        (refund) =>
          (charge === undefined || refund.charge === charge) &&
          (intent === undefined || refund.payment_intent === intent),
      ),
      "/v1/refunds",
    )
  })
}
