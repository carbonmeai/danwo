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

/** Stores a new PaymentIntent and emits `payment_intent.created`. */
export function createIntent(payments: Payments, fields: IntentFields): PaymentIntent {
  const intent = payments.objects.paymentIntents.add(
    paymentIntentObject({ id: newId("pi"), created: unix(payments.clock()), ...fields }),
    null,
  )

  payments.events.emit("payment_intent.created", intent)

  return intent
}

/**
 * Pays `intent` with `method`, as an approved card payment does: a captured charge, the intent
 * `succeeded`, and the card saved to the customer when the intent asked for future use. Emits
 * `payment_method.attached` (when saved), `payment_intent.succeeded` and `charge.succeeded`.
 */
export function payIntent(
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
    }) ?? intent

  events.emit("payment_intent.succeeded", paid)
  events.emit("charge.succeeded", charge)

  return paid
}
