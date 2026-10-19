import type { Context } from "../../http.ts"
import { isOneOf } from "../../json.ts"
import type { MissingPaymentMethod } from "../billing-objects.ts"
import type { StripeRouteContext } from "../context.ts"
import type { Customer, Subscription } from "../entities.ts"
import {
  asRecord,
  flag,
  integer,
  items,
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
import {
  changeSubscription,
  currentPeriodEnd,
  endSubscription,
  type ItemRequest,
  type PaymentBehavior,
  renew,
  subscribe,
  type SubscribeRequest,
} from "../subscribing.ts"

type Params = Record<string, unknown>

const BEHAVIORS: readonly PaymentBehavior[] = [
  "allow_incomplete",
  "default_incomplete",
  "error_if_incomplete",
]
const MISSING: readonly MissingPaymentMethod[] = ["cancel", "create_invoice", "pause"]

/** One requested item: its recurring price, quantity and metadata, or the price id at fault. */
function itemOf(context: StripeRouteContext, raw: unknown): ItemRequest | { readonly bad: string } {
  const item = asRecord(raw) ?? {}
  const id = text(item.price) ?? ""
  const price = context.objects.prices.get(id)

  if (!price?.recurring) return { bad: id }

  return { price, quantity: integer(item.quantity) ?? 1, metadata: metadataOf(item.metadata) ?? {} }
}

/** The prices `items[n][price]` names, or the first one that is unknown or not recurring. */
function itemsOf(
  context: StripeRouteContext,
  params: Params,
): ItemRequest[] | { readonly bad: string } {
  const requested: ItemRequest[] = []

  for (const raw of items(params.items)) {
    const item = itemOf(context, raw)

    if ("bad" in item) return item
    requested.push(item)
  }

  return requested
}

/** When the trial ends: `trial_end` (a timestamp), else `trial_period_days` from now. */
function trialEndOf(context: StripeRouteContext, params: Params): number | null {
  const end = integer(params.trial_end)

  if (end !== undefined) return end

  const days = integer(params.trial_period_days)

  return days === undefined || days <= 0 ? null : unix(context.clock()) + days * 86_400
}

/** `trial_settings[end_behavior][missing_payment_method]`; Stripe's default is `create_invoice`. */
function missingOf(params: Params): MissingPaymentMethod {
  const value = asRecord(asRecord(params.trial_settings)?.end_behavior)?.missing_payment_method

  return isOneOf(MISSING, value) ? value : "create_invoice"
}

/** What a create request asks `subscribe` for. */
function requestOf(
  context: StripeRouteContext,
  params: Params,
  customer: Customer,
  requested: readonly ItemRequest[],
): SubscribeRequest {
  const behavior = params.payment_behavior
  const save = asRecord(params.payment_settings)?.save_default_payment_method

  return {
    customer,
    items: requested,
    trialEnd: trialEndOf(context, params),
    defaultPaymentMethod: textOrNull(params.default_payment_method),
    behavior: isOneOf(BEHAVIORS, behavior) ? behavior : "allow_incomplete",
    missingPaymentMethod: missingOf(params),
    saveDefaultPaymentMethod: save === "on_subscription" ? "on_subscription" : "off",
    description: textOrNull(params.description),
    metadata: metadataOf(params.metadata) ?? {},
  }
}

async function createSubscription(c: Context, context: StripeRouteContext): Promise<Response> {
  const params = await readParams(c)
  const customerId = text(params.customer) ?? ""
  const customer = context.objects.customers.get(customerId)

  if (!customer) return noSuch(c, "customer", customerId, "customer")

  const requested = itemsOf(context, params)

  if ("bad" in requested) return noSuch(c, "price", requested.bad, "items[0][price]")
  if (requested.length === 0)
    return stripeError(
      c,
      400,
      "invalid_request_error",
      "Missing required param: items.",
      "parameter_missing",
      "items",
    )

  const started = subscribe(context, requestOf(context, params, customer, requested))

  if ("code" in started)
    return stripeError(c, started.status, started.type, started.message, started.code)

  return c.json(started)
}

/** The price an update moves an item to, by `items[n][id]` and `items[n][price]`. */
function swappedItems(context: StripeRouteContext, subscription: Subscription, params: Params) {
  const swaps = items(params.items).map(asRecord)

  if (swaps.length === 0) return undefined

  return subscription.items.data.map((item, index) => {
    const swap = swaps.find((s) => text(s?.id) === item.id) ?? swaps[index]
    const price = context.objects.prices.get(text(swap?.price) ?? "")

    return {
      ...item,
      ...(price && { price, plan: { ...item.plan, id: price.id, amount: price.unit_amount } }),
      quantity: integer(swap?.quantity) ?? item.quantity ?? 1,
    }
  })
}

/** The cancellation fields an update changes: `cancel_at_period_end` and `cancel_at`. */
function cancellationUpdates(
  context: StripeRouteContext,
  subscription: Subscription,
  params: Params,
): Partial<Subscription> {
  const atEnd = flag(params.cancel_at_period_end)
  const at = integer(params.cancel_at)

  if (atEnd !== undefined)
    return {
      cancel_at_period_end: atEnd,
      cancel_at: atEnd ? currentPeriodEnd(subscription) : null,
      canceled_at: atEnd ? unix(context.clock()) : null,
    }

  return at === undefined ? {} : { cancel_at: at }
}

/** The plain fields an update changes: default card, description and metadata. */
function fieldUpdates(subscription: Subscription, params: Params): Partial<Subscription> {
  const changes: Partial<Subscription> = {}

  if (params.default_payment_method !== undefined)
    changes.default_payment_method = text(params.default_payment_method) || null
  if (params.description !== undefined) changes.description = text(params.description) || null
  if (params.metadata !== undefined)
    changes.metadata = mergeMetadata(subscription.metadata, metadataOf(params.metadata))

  return changes
}

/** The fields an update changes: cancellation, default card, metadata, description and items. */
function updatesOf(
  context: StripeRouteContext,
  subscription: Subscription,
  params: Params,
): Partial<Subscription> {
  const swapped = swappedItems(context, subscription, params)

  return {
    ...cancellationUpdates(context, subscription, params),
    ...fieldUpdates(subscription, params),
    ...(swapped && { items: { ...subscription.items, data: swapped } }),
  }
}

async function updateSubscription(c: Context, context: StripeRouteContext): Promise<Response> {
  const id = c.req.param("id")
  const subscription = context.objects.subscriptions.get(id)

  if (!subscription) return noSuch(c, "subscription", id)
  if (subscription.status === "canceled")
    return stripeError(
      c,
      400,
      "invalid_request_error",
      "A canceled subscription can only update its cancellation_details and metadata.",
    )

  const params = await readParams(c)
  const updated = changeSubscription(
    context,
    subscription,
    updatesOf(context, subscription, params),
  )

  // `trial_end=now` ends the trial at once and bills the first full period.
  if (params.trial_end === "now" && updated.status === "trialing") {
    const ended =
      context.objects.subscriptions.change(updated.id, {
        trial_end: unix(context.clock()),
        items: {
          ...updated.items,
          data: updated.items.data.map((item) => ({
            ...item,
            current_period_end: unix(context.clock()),
          })),
        },
      }) ?? updated

    return c.json(renew(context, ended))
  }

  return c.json(updated)
}

/** Subscriptions a list call matches: by customer, price and status (all but canceled by default). */
function listed(context: StripeRouteContext, query: (name: string) => string | undefined) {
  const customer = query("customer")
  const price = query("price")
  const status = query("status")

  return context.objects.subscriptions.where(
    (s) =>
      (customer === undefined || s.customer === customer) &&
      (price === undefined || s.items.data.some((item) => item.price.id === price)) &&
      (status === "all" || (status === undefined ? s.status !== "canceled" : s.status === status)),
  )
}

/** Subscriptions: create, retrieve, update (cancel at period end, end a trial, swap prices), cancel and list. */
export function subscriptionRoutes(context: StripeRouteContext): void {
  const { app, objects } = context

  app.post("/v1/subscriptions", (c) => createSubscription(c, context))
  app.get("/v1/subscriptions/:id", (c) => {
    const id = c.req.param("id")
    const subscription = objects.subscriptions.get(id)

    return subscription ? c.json(subscription) : noSuch(c, "subscription", id)
  })
  app.post("/v1/subscriptions/:id", (c) => updateSubscription(c, context))
  app.delete("/v1/subscriptions/:id", (c) => {
    const id = c.req.param("id")
    const subscription = objects.subscriptions.get(id)

    if (!subscription) return noSuch(c, "subscription", id)
    if (subscription.status === "canceled") return c.json(subscription)

    return c.json(endSubscription(context, subscription, "cancellation_requested"))
  })
  app.get("/v1/subscriptions", (c) =>
    listPage(
      c,
      listed(context, (name) => c.req.query(name)),
      "/v1/subscriptions",
    ),
  )
}
