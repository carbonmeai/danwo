import { cardOutcome } from "./cards.ts"
import type { StripeRouteContext } from "./context.ts"
import type { PaymentIntent, PaymentMethod } from "./entities.ts"
import { chargeObject, paymentIntentObject } from "./formatters.ts"
import { newId, unix } from "./helpers.ts"

type Payments = Pick<StripeRouteContext, "objects" | "events" | "baseUrl" | "clock">

/** What a new PaymentIntent is created with. */
export interface IntentFields {
  readonly amount: number
  readonly currency: string
  readonly customer: string | null
  readonly description: string | null
  readonly metadata: Record<string, string>
  readonly paymentMethod: string | null
  readonly setupFutureUsage: "off_session" | "on_session" | null
  readonly receiptEmail: string | null
  /** The intent's dynamic payment methods setting, when the request asked for it. */
  readonly automaticPaymentMethods?: AutomaticPaymentMethods | null
}

/** `automatic_payment_methods`, as an intent reports it. */
export interface AutomaticPaymentMethods {
  readonly enabled: boolean
  readonly allow_redirects: "always" | "never"
}

/** The account's default payment method configuration, which dynamic payment methods draw from. */
function defaultConfiguration(payments: Payments): string | null {
  return (
    payments.objects.paymentMethodConfigurations.where((found) => found.is_default)[0]?.id ?? null
  )
}

/** Stores a new PaymentIntent and emits `payment_intent.created`. */
export function createIntent(payments: Payments, fields: IntentFields): PaymentIntent {
  const configuration = fields.automaticPaymentMethods?.enabled
    ? defaultConfiguration(payments)
    : null
  const intent = payments.objects.paymentIntents.add(
    paymentIntentObject({
      id: newId("pi"),
      created: unix(payments.clock()),
      ...fields,
      configuration,
    }),
    null,
  )

  payments.events.emit("payment_intent.created", intent)

  return intent
}

/** The error a declined card leaves on the intent or setup that tried it. */
export interface DeclineError {
  code: string
  decline_code: string
  doc_url: string
  message: string
  payment_method: PaymentMethod
  type: "card_error"
}

/** The decline `method` gets: a generic `card_declined`. */
export function declineError(method: PaymentMethod): DeclineError {
  return {
    code: "card_declined",
    decline_code: "generic_decline",
    doc_url: "https://stripe.com/docs/error-codes/card-declined",
    message: "Your card was declined.",
    payment_method: method,
    type: "card_error",
  }
}

/** The next action 3D Secure asks of the browser, as Stripe.js reads it. */
export const AUTHENTICATE_ACTION = {
  type: "use_stripe_sdk",
  use_stripe_sdk: { type: "three_d_secure_redirect", stripe_js: "", source: "" },
} as const

/**
 * Charges `intent` to `method` as its test card behaves: approved cards pay it (see `payIntent`);
 * declined ones leave it `requires_payment_method` with the decline as `last_payment_error`
 * (`payment_intent.payment_failed`); 3D Secure cards leave it `requires_action`
 * (`payment_intent.requires_action`).
 */
export function chargeIntent(
  payments: Payments,
  intent: PaymentIntent,
  method: PaymentMethod,
): PaymentIntent {
  const outcome = cardOutcome(method, "charge")

  if (outcome === "approved") return payIntent(payments, intent, method)

  const { paymentIntents } = payments.objects
  const failed =
    outcome === "authenticate"
      ? paymentIntents.change(intent.id, {
          status: "requires_action",
          payment_method: method.id,
          next_action: AUTHENTICATE_ACTION,
        })
      : paymentIntents.change(intent.id, {
          status: "requires_payment_method",
          payment_method: null,
          last_payment_error: declineError(method),
        })
  const result = failed ?? intent

  payments.events.emit(
    outcome === "authenticate" ? "payment_intent.requires_action" : "payment_intent.payment_failed",
    result,
  )

  return result
}

/**
 * Pays `intent` with `method`, as an approved card payment does: a captured charge, the intent
 * `succeeded`, and the card saved to the customer when the intent asked for future use. Emits
 * `payment_method.attached` (when saved), `payment_intent.succeeded` and `charge.succeeded`.
 */
function payIntent(
  payments: Payments,
  intent: PaymentIntent,
  method: PaymentMethod,
): PaymentIntent {
  const { objects, events } = payments
  const chargeId = newId("ch")
  const charge = objects.charges.add(
    chargeObject({
      id: chargeId,
      created: unix(payments.clock()),
      intent,
      paymentMethod: method.id,
      card: method.card ?? null,
      receiptUrl: `${payments.baseUrl}/receipts/${chargeId}`,
    }),
    null,
  )
  const customer = typeof intent.customer === "string" ? intent.customer : null

  if (intent.setup_future_usage && customer && method.customer === null) {
    const saved = objects.paymentMethods.change(method.id, { customer })

    if (saved) events.emit("payment_method.attached", saved)
  }

  const paid =
    objects.paymentIntents.change(intent.id, {
      status: "succeeded",
      amount_received: intent.amount,
      latest_charge: charge.id,
      payment_method: method.id,
      last_payment_error: null,
      next_action: null,
    }) ?? intent

  events.emit("payment_intent.succeeded", paid)
  events.emit("charge.succeeded", charge)

  return paid
}
