import type { Context } from "../../http.ts"
import { setupIntentObject } from "../billing-objects.ts"
import { cardOutcome, paymentMethodFor } from "../cards.ts"
import type { StripeRouteContext } from "../context.ts"
import type { PaymentMethod, SetupIntent } from "../entities.ts"
import {
  flag,
  idOf,
  listPage,
  metadataOf,
  newId,
  noSuch,
  readParams,
  stripeError,
  text,
  textOrNull,
  unix,
} from "../helpers.ts"
import { AUTHENTICATE_ACTION, declineError } from "../payments.ts"

/** The answer when a SetupIntent is in the wrong state for what was asked. */
function wrongState(c: Context, intent: SetupIntent, action: string): Response {
  return stripeError(
    c,
    400,
    "invalid_request_error",
    `You cannot ${action} this SetupIntent because it has a status of ${intent.status}.`,
    "setup_intent_unexpected_state",
  )
}

/** The payment method a confirmation names, or the answer refusing it. */
function methodToSave(
  c: Context,
  context: StripeRouteContext,
  intent: SetupIntent,
  reference: string | undefined,
): PaymentMethod | Response {
  if (intent.status === "succeeded" || intent.status === "canceled")
    return wrongState(c, intent, "confirm")

  const wanted = reference ?? idOf(intent.payment_method)

  if (!wanted)
    return stripeError(
      c,
      400,
      "invalid_request_error",
      "You cannot confirm this SetupIntent because it's missing a payment method.",
      "setup_intent_unexpected_state",
    )

  return (
    paymentMethodFor(context.objects, wanted, context.clock()) ??
    noSuch(c, "PaymentMethod", wanted, "payment_method")
  )
}

/** A declined card: `requires_payment_method` with the decline, and a 402. */
function declined(
  c: Context,
  context: StripeRouteContext,
  intent: SetupIntent,
  method: PaymentMethod,
) {
  const failed = context.objects.setupIntents.change(intent.id, {
    status: "requires_payment_method",
    payment_method: null,
    latest_attempt: newId("setatt"),
    last_setup_error: declineError(method),
  })

  context.events.emit("setup_intent.setup_failed", failed ?? intent)

  return stripeError(c, 402, "card_error", "Your card was declined.", "card_declined")
}

/** A 3D Secure card: `requires_action` until the browser authenticates it. */
function held(
  context: StripeRouteContext,
  intent: SetupIntent,
  method: PaymentMethod,
): SetupIntent {
  const changed = context.objects.setupIntents.change(intent.id, {
    status: "requires_action",
    payment_method: method.id,
    latest_attempt: newId("setatt"),
    next_action: AUTHENTICATE_ACTION,
  })

  context.events.emit("setup_intent.requires_action", changed ?? intent)

  return changed ?? intent
}

/** An approved card: attached to the customer and the intent `succeeded`. */
function saved(
  context: StripeRouteContext,
  intent: SetupIntent,
  method: PaymentMethod,
): SetupIntent {
  const { objects, events } = context
  const customer = idOf(intent.customer)

  if (customer && method.customer === null) {
    const attached = objects.paymentMethods.change(method.id, { customer })

    if (attached) events.emit("payment_method.attached", attached)
  }

  const done = objects.setupIntents.change(intent.id, {
    status: "succeeded",
    payment_method: method.id,
    latest_attempt: newId("setatt"),
    last_setup_error: null,
    next_action: null,
  })

  events.emit("setup_intent.succeeded", done ?? intent)

  return done ?? intent
}

/**
 * Saves `reference` through `intent`, as its test card behaves: approved cards are attached to the
 * customer (`payment_method.attached`) and the intent `succeeded`; declined ones leave
 * `requires_payment_method` with `last_setup_error` (`setup_intent.setup_failed`); 3D Secure ones
 * leave `requires_action`.
 */
function confirmSetup(
  c: Context,
  context: StripeRouteContext,
  intent: SetupIntent,
  reference: string | undefined,
): Response {
  const method = methodToSave(c, context, intent, reference)

  if (method instanceof Response) return method

  const outcome = cardOutcome(method, "setup")

  if (outcome === "declined") return declined(c, context, intent, method)

  return c.json(
    outcome === "authenticate" ? held(context, intent, method) : saved(context, intent, method),
  )
}

/**
 * Saves `method` for `customer` through a new SetupIntent, as a setup-mode Checkout Session does
 * when the payer presses Save: the intent and the card as they end up, or the decline. A card that
 * asks for 3D Secure counts as authenticated, as the hosted page completes the challenge itself.
 */
export function saveCardForCheckout(
  context: StripeRouteContext,
  fields: {
    readonly customer: string | null
    readonly method: PaymentMethod
    readonly metadata: Record<string, string>
  },
): { readonly intent: SetupIntent } | { readonly declined: string; readonly intent: SetupIntent } {
  const intent = context.objects.setupIntents.add(
    setupIntentObject({
      id: newId("seti"),
      created: unix(context.clock()),
      customer: fields.customer,
      paymentMethod: null,
      usage: "off_session",
      description: null,
      metadata: fields.metadata,
      configuration: null,
    }),
    null,
  )

  context.events.emit("setup_intent.created", intent)

  if (cardOutcome(fields.method, "setup") === "declined") {
    const failed = context.objects.setupIntents.change(intent.id, {
      status: "requires_payment_method",
      latest_attempt: newId("setatt"),
      last_setup_error: declineError(fields.method),
    })

    context.events.emit("setup_intent.setup_failed", failed ?? intent)

    return { declined: "Your card was declined.", intent: failed ?? intent }
  }

  return { intent: saved(context, intent, fields.method) }
}

async function createSetup(c: Context, context: StripeRouteContext): Promise<Response> {
  const params = await readParams(c)
  const customer = textOrNull(params.customer)

  if (customer && !context.objects.customers.get(customer))
    return noSuch(c, "customer", customer, "customer")

  const configuration =
    context.objects.paymentMethodConfigurations.where((found) => found.is_default)[0]?.id ?? null
  const intent = context.objects.setupIntents.add(
    setupIntentObject({
      id: newId("seti"),
      created: unix(context.clock()),
      customer,
      paymentMethod: textOrNull(params.payment_method),
      usage: params.usage === "on_session" ? "on_session" : "off_session",
      description: textOrNull(params.description),
      metadata: metadataOf(params.metadata) ?? {},
      configuration,
    }),
    null,
  )

  context.events.emit("setup_intent.created", intent)

  return flag(params.confirm) ? confirmSetup(c, context, intent, undefined) : c.json(intent)
}

/** SetupIntents: create (optionally confirming), retrieve, confirm, cancel and list. */
export function setupIntentRoutes(context: StripeRouteContext): void {
  const { app, objects, events } = context
  const intents = objects.setupIntents

  app.post("/v1/setup_intents", (c) => createSetup(c, context))
  app.get("/v1/setup_intents/:id", (c) => {
    const id = c.req.param("id")
    const intent = intents.get(id)

    return intent ? c.json(intent) : noSuch(c, "setup_intent", id)
  })
  app.post("/v1/setup_intents/:id/confirm", async (c) => {
    const id = c.req.param("id")
    const intent = intents.get(id)

    if (!intent) return noSuch(c, "setup_intent", id)

    return confirmSetup(c, context, intent, text((await readParams(c)).payment_method))
  })
  app.post("/v1/setup_intents/:id/cancel", (c) => {
    const id = c.req.param("id")
    const intent = intents.get(id)

    if (!intent) return noSuch(c, "setup_intent", id)
    if (intent.status === "succeeded" || intent.status === "canceled")
      return wrongState(c, intent, "cancel")

    const canceled = intents.change(id, {
      status: "canceled",
      cancellation_reason: "requested_by_customer",
    })

    events.emit("setup_intent.canceled", canceled ?? intent)

    return c.json(canceled)
  })
  app.get("/v1/setup_intents", (c) => {
    const customer = c.req.query("customer")

    return listPage(
      c,
      intents.where((intent) => customer === undefined || intent.customer === customer),
      "/v1/setup_intents",
    )
  })
}
