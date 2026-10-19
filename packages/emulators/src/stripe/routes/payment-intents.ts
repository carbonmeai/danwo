import type { Context } from "../../http.ts"
import { isOneOf } from "../../json.ts"
import { paymentMethodFor } from "../cards.ts"
import type { StripeRouteContext } from "../context.ts"
import type { PaymentIntent } from "../entities.ts"
import {
  asRecord,
  badParam,
  clearableTexts,
  flag,
  integer,
  listPage,
  mergeMetadata,
  metadataOf,
  noSuch,
  readParams,
  stripeError,
  text,
  textOrNull,
  unix,
} from "../helpers.ts"
import { invoiceOfIntent, markPaid } from "../invoicing.ts"
import {
  type AutomaticPaymentMethods,
  chargeIntent,
  createIntent,
  type IntentFields,
} from "../payments.ts"
import { invoicePaid } from "../subscribing.ts"

/**
 * When a confirmed intent collects an open invoice (a subscription's first payment, confirmed
 * by the app's page with the invoice's `confirmation_secret`), the invoice is paid and its
 * subscription becomes active.
 */
function settleInvoiceOf(context: StripeRouteContext, intent: PaymentIntent): void {
  const invoice = invoiceOfIntent(context, intent)

  if (invoice?.status !== "open") return

  invoicePaid(context, markPaid(context, invoice, intent))
}

type FutureUsage = "off_session" | "on_session" | null
type CancelReason = "duplicate" | "fraudulent" | "requested_by_customer" | "abandoned"

const CANCEL_REASONS: readonly CancelReason[] = [
  "duplicate",
  "fraudulent",
  "requested_by_customer",
  "abandoned",
]

/**
 * `automatic_payment_methods[enabled]` and `[allow_redirects]` from a create request, the way an
 * account with dynamic payment methods asks for an intent instead of listing its methods.
 */
function automaticMethods(value: unknown): AutomaticPaymentMethods | null {
  const setting = asRecord(value)

  if (!setting) return null

  return {
    enabled: flag(setting.enabled) ?? false,
    allow_redirects: setting.allow_redirects === "never" ? "never" : "always",
  }
}

function futureUsage(value: unknown): FutureUsage {
  return value === "off_session" || value === "on_session" ? value : null
}

/** A new intent's fields from a create request. */
function intentFields(
  params: Record<string, unknown>,
  amount: number,
  currency: string,
): IntentFields {
  return {
    amount,
    currency,
    customer: textOrNull(params.customer),
    description: textOrNull(params.description),
    metadata: metadataOf(params.metadata) ?? {},
    paymentMethod: textOrNull(params.payment_method),
    setupFutureUsage: futureUsage(params.setup_future_usage),
    receiptEmail: textOrNull(params.receipt_email),
    automaticPaymentMethods: automaticMethods(params.automatic_payment_methods),
  }
}

/** What an update request changes. Choosing a payment method makes the intent ready to confirm. */
function intentChanges(
  params: Record<string, unknown>,
  current: PaymentIntent,
): Partial<PaymentIntent> {
  const amount = integer(params.amount)
  const currency = text(params.currency)?.toLowerCase()
  const customer = text(params.customer)
  const method = text(params.payment_method)

  return {
    ...clearableTexts(params, ["description"] as const),
    ...(amount !== undefined && { amount }),
    ...(currency && { currency }),
    ...(customer && { customer }),
    ...(method && { payment_method: method, status: "requires_confirmation" as const }),
    ...(params.setup_future_usage !== undefined && {
      setup_future_usage: futureUsage(params.setup_future_usage),
    }),
    metadata: mergeMetadata(current.metadata, metadataOf(params.metadata)),
  }
}

/** Stripe's answer when an intent is in the wrong state for what was asked. */
function wrongState(c: Context, intent: PaymentIntent, action: string): Response {
  return stripeError(
    c,
    400,
    "invalid_request_error",
    `You cannot ${action} this PaymentIntent because it has a status of ${intent.status}.`,
    "payment_intent_unexpected_state",
  )
}

/** PaymentIntents: create (optionally confirming), retrieve, update, confirm, cancel and list. */
export function paymentIntentRoutes(context: StripeRouteContext): void {
  const { app, objects, events, clock } = context
  const intents = objects.paymentIntents

  /** Confirms with the given or attached payment method; a test card always succeeds. */
  const confirm = (c: Context, intent: PaymentIntent, reference: string | undefined) => {
    if (intent.status === "succeeded" || intent.status === "canceled")
      return wrongState(c, intent, "confirm")

    const wanted =
      reference ?? (typeof intent.payment_method === "string" ? intent.payment_method : undefined)

    if (!wanted)
      return stripeError(
        c,
        400,
        "invalid_request_error",
        "You cannot confirm this PaymentIntent because it's missing a payment method. You can either update the PaymentIntent with a payment method and then confirm it again, or confirm it again directly with a payment method.",
        "payment_intent_unexpected_state",
      )

    const method = paymentMethodFor(objects, wanted, clock())

    if (!method) return noSuch(c, "PaymentMethod", wanted, "payment_method")

    const charged = chargeIntent(context, intent, method)

    if (charged.status === "succeeded") settleInvoiceOf(context, charged)
    if (charged.status === "requires_payment_method")
      return stripeError(c, 402, "card_error", "Your card was declined.", "card_declined")

    return c.json(charged)
  }

  app.post("/v1/payment_intents", async (c) => {
    const params = await readParams(c)
    const amount = integer(params.amount)
    const currency = text(params.currency)?.toLowerCase()

    if (amount === undefined) return badParam(c, "amount")
    if (!currency) return badParam(c, "currency")

    const fields = intentFields(params, amount, currency)

    if (fields.customer && !objects.customers.get(fields.customer))
      return noSuch(c, "customer", fields.customer, "customer")

    const intent = createIntent(context, fields)

    return flag(params.confirm) ? confirm(c, intent, undefined) : c.json(intent)
  })

  app.get("/v1/payment_intents/:id", (c) => {
    const id = c.req.param("id")
    const intent = intents.get(id)

    return intent ? c.json(intent) : noSuch(c, "payment_intent", id)
  })

  app.post("/v1/payment_intents/:id", async (c) => {
    const id = c.req.param("id")
    const current = intents.get(id)

    if (!current) return noSuch(c, "payment_intent", id)
    if (current.status === "succeeded" || current.status === "canceled")
      return wrongState(c, current, "update")

    const updated = intents.change(id, intentChanges(await readParams(c), current))

    return c.json(updated)
  })

  app.post("/v1/payment_intents/:id/confirm", async (c) => {
    const id = c.req.param("id")
    const intent = intents.get(id)

    if (!intent) return noSuch(c, "payment_intent", id)

    return confirm(c, intent, text((await readParams(c)).payment_method))
  })

  app.post("/v1/payment_intents/:id/cancel", async (c) => {
    const id = c.req.param("id")
    const intent = intents.get(id)

    if (!intent) return noSuch(c, "payment_intent", id)
    if (intent.status === "succeeded" || intent.status === "canceled")
      return wrongState(c, intent, "cancel")

    const reason = (await readParams(c)).cancellation_reason
    const canceled = intents.change(id, {
      status: "canceled",
      canceled_at: unix(clock()),
      cancellation_reason: isOneOf(CANCEL_REASONS, reason) ? reason : null,
    })

    if (canceled) events.emit("payment_intent.canceled", canceled)

    return c.json(canceled)
  })

  app.get("/v1/payment_intents", (c) => {
    const customer = c.req.query("customer")

    return listPage(
      c,
      intents.where((intent) => customer === undefined || intent.customer === customer),
      "/v1/payment_intents",
    )
  })
}
