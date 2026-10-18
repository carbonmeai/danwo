import type { Context } from "../../http.ts"
import { isOneOf } from "../../json.ts"
import { requireIntegration } from "../auth.ts"
import type { PaystackRouteContext } from "../context.ts"
import { type Integration, INTERVALS, type Plan } from "../entities.ts"
import { planObject } from "../formatters.ts"
import { amountOf, bodyOf, currencyOf, fail, nextId, ok, pageOf, text } from "../helpers.ts"
import type { PaystackPayments } from "../payments.ts"
import type { PaystackStore } from "../store.ts"
import { customerInBody } from "./customers.ts"

/** The integration's plan by code or numeric id. */
function findPlan(
  paystack: PaystackStore,
  integration: Integration,
  key: string,
): Plan | undefined {
  return paystack.plans.where(
    (plan) =>
      plan.integration === integration.number &&
      (plan.plan_code === key || String(plan.id) === key),
  )[0]
}

async function createPlan(c: Context, context: PaystackRouteContext): Promise<Response> {
  const integration = requireIntegration(c, context.paystack)
  const fields = await bodyOf(c)
  const name = text(fields, "name")
  const amount = amountOf(fields)
  const interval = text(fields, "interval")
  const currency = currencyOf(fields, "NGN")

  if (name === undefined) return fail(c, 400, "Name is required")
  if (amount === undefined) return fail(c, 400, "Invalid Amount Sent")
  if (!isOneOf(INTERVALS, interval)) return fail(c, 400, "Invalid interval")
  if (currency === undefined) return fail(c, 400, "Currency not supported by merchant")

  const plan = context.paystack.plans.add(
    planObject({
      id: nextId(context.store),
      name,
      amount,
      interval,
      currency,
      description: text(fields, "description") ?? null,
      invoiceLimit: Number(text(fields, "invoice_limit") ?? 0) || 0,
      integration,
      now: context.clock(),
    }),
    null,
  )

  return ok(c, "Plan created", plan)
}

async function createSubscription(
  c: Context,
  context: PaystackRouteContext,
  payments: PaystackPayments,
): Promise<Response> {
  const { paystack } = context
  const { integration, fields, customer } = await customerInBody(c, paystack)
  const plan = findPlan(paystack, integration, text(fields, "plan") ?? "")
  const savedCode = text(fields, "authorization")
  const authorization = paystack.authorizations
    .all()
    .find(
      (a) =>
        a.reusable &&
        paystack.authorizations.extra(a.authorization_code)?.customer === customer?.customer_code &&
        (savedCode === undefined || a.authorization_code === savedCode),
    )

  if (customer === undefined) return fail(c, 404, "Customer not found")
  if (plan === undefined) return fail(c, 404, "Plan not found")
  if (authorization === undefined) return fail(c, 400, "This customer has no saved authorizations")

  return ok(
    c,
    "Subscription successfully created",
    payments.subscribe(plan, customer, authorization),
  )
}

/** Enable or disable: Paystack asks for the subscription's code and its email token. */
async function toggle(
  c: Context,
  context: PaystackRouteContext,
  act: (code: string) => object | undefined,
  done: string,
): Promise<Response> {
  const fields = await bodyOf(c)
  const code = text(fields, "code") ?? ""
  const subscription = context.paystack.subscriptions.get(code)

  if (subscription === undefined || subscription.email_token !== text(fields, "token"))
    return fail(c, 400, "Subscription with code not found or already inactive")

  act(code)

  return c.json({ status: true, message: done })
}

/** Plans and subscriptions, with renewals charged on the emulator's clock. */
export function planRoutes(context: PaystackRouteContext, payments: PaystackPayments): void {
  const { app, paystack } = context

  app.post("/plan", (c) => createPlan(c, context))

  app.get("/plan", (c) => {
    const integration = requireIntegration(c, paystack)
    const { data, meta } = pageOf(
      c,
      paystack.plans.where((p) => p.integration === integration.number),
    )

    return ok(c, "Plans retrieved", data, { meta })
  })

  app.get("/plan/:key", (c) => {
    const plan = findPlan(paystack, requireIntegration(c, paystack), c.req.param("key"))

    return plan ? ok(c, "Plan retrieved", plan) : fail(c, 404, "Plan not found")
  })

  app.post("/subscription", (c) => createSubscription(c, context, payments))
  app.post("/subscription/enable", (c) =>
    toggle(c, context, (code) => payments.enable(code), "Subscription enabled successfully"),
  )
  app.post("/subscription/disable", (c) =>
    toggle(c, context, (code) => payments.disable(code), "Subscription disabled successfully"),
  )

  app.get("/subscription", (c) => {
    const integration = requireIntegration(c, paystack)
    const mine = paystack.subscriptions.where((s) => s.integration === integration.number)
    const { data, meta } = pageOf(c, mine)

    return ok(c, "Subscriptions retrieved", data, { meta })
  })

  app.get("/subscription/:code", (c) => {
    const subscription = paystack.subscriptions.get(c.req.param("code"))

    return subscription
      ? ok(c, "Subscription retrieved successfully", subscription)
      : fail(c, 404, "Subscription not found")
  })
}
