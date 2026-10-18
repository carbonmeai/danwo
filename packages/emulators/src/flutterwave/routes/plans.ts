/**
 * Payment plans and the subscriptions customers start by paying for one: create, list, fetch,
 * update and cancel plans; list, cancel and activate subscriptions.
 */
import { HttpError } from "../../errors.ts"
import type { Context } from "../../http.ts"
import { isOneOf } from "../../json.ts"
import type { FlutterwaveRouteContext } from "../context.ts"
import type { PaymentPlan, PlanInterval, Subscription } from "../entities.ts"
import type { FlutterwaveEvents } from "../events.ts"
import {
  amountOf,
  failure,
  hex,
  isoTime,
  jsonBody,
  nextId,
  pageOf,
  required,
  success,
  text,
} from "../helpers.ts"

const INTERVALS: readonly PlanInterval[] = [
  "hourly",
  "daily",
  "weekly",
  "monthly",
  "quarterly",
  "bi-annually",
  "yearly",
]

function newPlan(context: FlutterwaveRouteContext, body: Record<string, unknown>): PaymentPlan {
  const interval = required(body, "interval").toLowerCase()
  const amount = amountOf(body, "amount")

  if (!isOneOf(INTERVALS, interval))
    throw new HttpError(400, `interval must be one of ${INTERVALS.join(", ")}`)
  if (amount === undefined || amount <= 0) throw new HttpError(400, "amount is required")

  return {
    id: nextId(context.store),
    name: required(body, "name"),
    amount,
    interval,
    duration: amountOf(body, "duration") ?? 0,
    status: "active",
    currency: (text(body, "currency") ?? "NGN").toUpperCase(),
    plan_token: `rpp_${hex(10)}`,
    created_at: isoTime(context.clock()),
  }
}

/** Whether a subscription matches the list filters in the query. */
function subscriptionMatches(c: Context, subscription: Subscription): boolean {
  const email = c.req.query("email")
  const plan = c.req.query("plan")
  const status = c.req.query("status")

  return (
    (email === undefined || subscription.customer.customer_email === email) &&
    (plan === undefined || String(subscription.plan) === plan) &&
    (status === undefined || subscription.status === status)
  )
}

function subscriptionRoutes(context: FlutterwaveRouteContext, events: FlutterwaveEvents): void {
  const { app, flutterwave } = context

  app.get("/v3/subscriptions", (c) => {
    const page = pageOf(
      c,
      flutterwave.subscriptions.where((subscription) => subscriptionMatches(c, subscription)),
    )

    return success(c, "Plan subscriptions fetched", page.data, page.meta)
  })

  app.put("/v3/subscriptions/:id/cancel", (c) => {
    const cancelled = flutterwave.subscriptions.change(c.req.param("id"), { status: "cancelled" })

    if (cancelled === undefined) return failure(c, 404, "Subscription not found")

    events.subscriptionCancelled(cancelled)

    return success(c, "Subscription cancelled", cancelled)
  })

  app.put("/v3/subscriptions/:id/activate", (c) => {
    const active = flutterwave.subscriptions.change(c.req.param("id"), { status: "active" })

    return active
      ? success(c, "Subscription activated", active)
      : failure(c, 404, "Subscription not found")
  })
}

export function planRoutes(context: FlutterwaveRouteContext, events: FlutterwaveEvents): void {
  const { app, flutterwave } = context

  app.post("/v3/payment-plans", async (c) => {
    const plan = flutterwave.plans.add(newPlan(context, await jsonBody(c)), null)

    return success(c, "Payment plan created", plan)
  })

  app.get("/v3/payment-plans", (c) => {
    const page = pageOf(c, flutterwave.plans.all().toReversed())

    return success(c, "Payment plans fetched", page.data, page.meta)
  })

  app.get("/v3/payment-plans/:id", (c) => {
    const plan = flutterwave.plans.get(c.req.param("id"))

    return plan ? success(c, "Payment plan fetched", plan) : failure(c, 404, "Plan not found")
  })

  app.put("/v3/payment-plans/:id", async (c) => {
    const body = await jsonBody(c)
    const name = text(body, "name")
    const status = text(body, "status")
    const changes = {
      ...(name !== undefined && { name }),
      ...(isOneOf(["active", "cancelled"], status) && { status }),
    }
    const plan = flutterwave.plans.change(c.req.param("id"), changes)

    return plan ? success(c, "Payment plan updated", plan) : failure(c, 404, "Plan not found")
  })

  app.put("/v3/payment-plans/:id/cancel", (c) => {
    const plan = flutterwave.plans.change(c.req.param("id"), { status: "cancelled" })

    return plan ? success(c, "Payment plan cancelled", plan) : failure(c, 404, "Plan not found")
  })

  subscriptionRoutes(context, events)
}
