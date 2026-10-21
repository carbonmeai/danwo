import type { Context } from "../../http.ts"
import { isOneOf } from "../../json.ts"
import { checkoutCardFor, paymentMethodFor } from "../cards.ts"
import { messagePage, renderPayPage } from "../checkout-page.ts"
import { subscribeSession, subscriptionPlan } from "../checkout-subscription.ts"
import type { StripeRouteContext } from "../context.ts"
import type {
  CheckoutSession,
  Invoice,
  PaymentIntent,
  SessionLine,
  SessionPlan,
} from "../entities.ts"
import { checkoutSessionObject, invoiceObject } from "../formatters.ts"
import {
  asRecord,
  badParam,
  flag,
  integer,
  items,
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
import { chargeIntent, createIntent } from "../payments.ts"
import { createPrice } from "./prices.ts"

type Mode = "payment" | "setup" | "subscription"
type Params = Record<string, unknown>

const DAY_SECONDS = 24 * 60 * 60

/** The header through which `danwo matrix` asks a route to misbehave in a way only it can. */
const EMULATE_HEADER = "x-danwo-emulate"

/** The behaviour that has the hosted page decline the card, whatever was typed. */
const CARD_DECLINED = "card_declined"
const MODES: readonly Mode[] = ["payment", "setup", "subscription"]

/** Session fields taken as given from the create request, by parameter name. */

type PriceRow = NonNullable<ReturnType<StripeRouteContext["objects"]["prices"]["get"]>>

/** A line item's price: an existing price id, or a new price from `price_data`. */
function priceFor(
  context: StripeRouteContext,
  item: Params,
): PriceRow | { readonly fault: string } {
  const priceId = text(item.price)

  if (priceId) return context.objects.prices.get(priceId) ?? { fault: `price:${priceId}` }

  const data = asRecord(item.price_data)

  if (!data) return { fault: "line_items[price]" }

  const price = createPrice(context, data)

  return "missing" in price ? { fault: `line_items[price_data][${price.missing}]` } : price
}

/** A session line for one requested line item. */
function lineFor(
  context: StripeRouteContext,
  item: Params,
): SessionLine | { readonly fault: string } {
  const price = priceFor(context, item)

  if ("fault" in price) return price

  const product =
    typeof price.product === "string" ? context.objects.products.get(price.product) : undefined

  return {
    price: price.id,
    quantity: integer(item.quantity) ?? 1,
    description: product?.name ?? price.nickname ?? price.id,
    unitAmount: price.unit_amount ?? 0,
    currency: price.currency,
  }
}

/** The answer for a parameter a session cannot be created with. */
function refuse(c: Context, fault: string): Response {
  if (fault.startsWith("price:")) return noSuch(c, "price", fault.slice(6), "line_items[0][price]")

  return badParam(c, fault)
}

/** What the PaymentIntent created on payment carries over from `payment_intent_data`. */
function intentPlan(params: Params): SessionPlan["intent"] {
  const data = asRecord(params.payment_intent_data) ?? {}
  const usage = data.setup_future_usage

  return {
    description: textOrNull(data.description),
    metadata: metadataOf(data.metadata) ?? {},
    setupFutureUsage: usage === "off_session" || usage === "on_session" ? usage : null,
  }
}

/** The invoice `invoice_creation[enabled]` asks for, or `null`. */
function invoicePlan(params: Params): SessionPlan["invoice"] {
  const invoicing = asRecord(params.invoice_creation)

  if (!flag(invoicing?.enabled)) return null

  const data = asRecord(invoicing?.invoice_data) ?? {}

  return { description: textOrNull(data.description), metadata: metadataOf(data.metadata) ?? {} }
}

/** Checks the references a create request makes; returns the refusal, if any. */
function checkReferences(
  c: Context,
  context: StripeRouteContext,
  params: Params,
): Response | undefined {
  const customer = text(params.customer)
  const configuration = text(params.payment_method_configuration)

  if (customer && !context.objects.customers.get(customer))
    return noSuch(c, "customer", customer, "customer")
  if (configuration && !context.objects.paymentMethodConfigurations.get(configuration))
    return noSuch(c, "payment method configuration", configuration, "payment_method_configuration")

  return undefined
}

/** Every line item resolved to a price, or the fault of the first that cannot be. */
function linesOf(
  context: StripeRouteContext,
  params: Params,
): SessionLine[] | { readonly fault: string } {
  const lines: SessionLine[] = []

  for (const item of items(params.line_items)) {
    const line = lineFor(context, asRecord(item) ?? {})

    if ("fault" in line) return line
    lines.push(line)
  }

  return lines
}

/** A new session object from validated parameters. */
function newSession(
  context: StripeRouteContext,
  params: Params,
  mode: Mode,
  plan: SessionPlan,
): CheckoutSession {
  const id = newId("cs")
  const created = unix(context.clock())

  return checkoutSessionObject({
    id,
    created,
    url: `${context.baseUrl}/checkout/${id}`,
    mode,
    lines: plan.lines,
    customer: textOrNull(params.customer),
    customerEmail: textOrNull(params.customer_email),
    expiresAt: integer(params.expires_at) ?? created + DAY_SECONDS,
    clientReferenceId: textOrNull(params.client_reference_id),
    metadata: metadataOf(params.metadata) ?? {},
    successUrl: textOrNull(params.success_url),
    cancelUrl: textOrNull(params.cancel_url),
    invoiceCreation: plan.invoice,
    configuration: textOrNull(params.payment_method_configuration),
  })
}

/** Creates a Checkout Session from the request's parameters. */
async function createSession(c: Context, context: StripeRouteContext): Promise<Response> {
  const params = await readParams(c)
  const mode = params.mode

  if (!isOneOf(MODES, mode)) return badParam(c, "mode")

  const refused = checkReferences(c, context, params)

  if (refused) return refused

  const lines = linesOf(context, params)

  if ("fault" in lines) return refuse(c, lines.fault)
  if (mode !== "setup" && lines.length === 0) return badParam(c, "line_items")

  const plan: SessionPlan = {
    lines,
    intent: intentPlan(params),
    invoice: invoicePlan(params),
    ...(mode === "subscription" && { subscription: subscriptionPlan(params) }),
  }

  return c.json(context.objects.checkoutSessions.add(newSession(context, params, mode, plan), plan))
}

/** The paid invoice Checkout's `invoice_creation` produces, through its lifecycle events. */
function invoiceFor(
  context: StripeRouteContext,
  session: CheckoutSession,
  plan: SessionPlan,
  intent: string,
): Invoice | undefined {
  if (!plan.invoice) return undefined

  const { objects, events, clock } = context
  const id = newId("in")
  const now = unix(clock())
  const customer = typeof session.customer === "string" ? session.customer : null
  const draft = objects.invoices.add(
    invoiceObject({
      id,
      number: `DANWO-${String(objects.invoices.all().length + 1).padStart(4, "0")}`,
      created: now,
      customer,
      customerEmail: session.customer_details?.email ?? session.customer_email,
      currency: session.currency ?? "usd",
      lines: plan.lines,
      description: plan.invoice.description,
      metadata: plan.invoice.metadata,
      hostedUrl: `${context.baseUrl}/invoices/${id}`,
    }),
    null,
  )

  events.emit("invoice.created", draft)

  const open = objects.invoices.change(id, {
    status: "open",
    effective_at: now,
    status_transitions: { ...draft.status_transitions, finalized_at: now },
  })

  if (open) events.emit("invoice.finalized", open)

  const paid = objects.invoices.change(id, {
    status: "paid",
    amount_paid: draft.amount_due,
    amount_remaining: 0,
    attempted: true,
    attempt_count: 1,
    status_transitions: { ...draft.status_transitions, finalized_at: now, paid_at: now },
    payments: {
      object: "list",
      data: [],
      has_more: false,
      url: `/v1/invoice_payments?invoice=${id}&payment_intent=${intent}`,
    },
  })

  if (paid) {
    events.emit("invoice.paid", paid)
    events.emit("invoice.payment_succeeded", paid)
  }

  return paid
}

/** The email the payer gave, else the one the session or its customer has. */
function payerEmail(
  context: StripeRouteContext,
  session: CheckoutSession,
  typed: string | null,
): string | null {
  const customer =
    typeof session.customer === "string"
      ? context.objects.customers.get(session.customer)
      : undefined

  return typed || session.customer_email || customer?.email || null
}

/** A payment the hosted page could not take, and what the payer is told. */
interface Declined {
  readonly declined: string
}

/**
 * The PaymentIntent a payment session charges: the one an earlier, declined attempt left
 * waiting for a payment method, as Checkout retries on the same intent, or a new one.
 */
function intentFor(
  context: StripeRouteContext,
  session: CheckoutSession,
  plan: SessionPlan,
): PaymentIntent {
  const earlier =
    typeof session.payment_intent === "string"
      ? context.objects.paymentIntents.get(session.payment_intent)
      : undefined

  if (earlier?.status === "requires_payment_method") return earlier

  return createIntent(context, {
    amount: session.amount_total ?? 0,
    currency: session.currency ?? "usd",
    customer: typeof session.customer === "string" ? session.customer : null,
    description: plan.intent.description,
    metadata: plan.intent.metadata,
    paymentMethod: null,
    setupFutureUsage: plan.intent.setupFutureUsage,
    receiptEmail: null,
  })
}

/**
 * Charges `card` for the session's total; returns the intent and invoice it made, or the
 * decline, which leaves the session open and its intent waiting for another card.
 */
function chargeSession(
  context: StripeRouteContext,
  session: CheckoutSession,
  plan: SessionPlan,
  payment: { readonly email: string | null; readonly card: string },
): Partial<CheckoutSession> | Declined {
  const intent = intentFor(context, session, plan)
  const method = paymentMethodFor(context.objects, payment.card, context.clock()) ?? orThrow()
  const charged = chargeIntent(context, intent, method)

  if (charged.status !== "succeeded") {
    context.objects.checkoutSessions.change(session.id, { payment_intent: charged.id })

    return { declined: charged.last_payment_error?.message ?? "Your card was declined." }
  }

  const invoice = invoiceFor(
    context,
    { ...session, customer_details: { ...emptyDetails(), email: payment.email } },
    plan,
    charged.id,
  )

  return { payment_status: "paid", payment_intent: charged.id, invoice: invoice?.id ?? null }
}

function orThrow(): never {
  throw new Error("the Checkout test card is missing")
}

/**
 * Takes the payment for an open session with the card the payer typed, as the hosted page's Pay
 * button does. Returns the completed session, or the decline.
 */
function paySession(
  context: StripeRouteContext,
  session: CheckoutSession,
  typed: { readonly email: string | null; readonly card: string },
): CheckoutSession | Declined {
  const plan = context.objects.checkoutSessions.extra(session.id)
  const email = payerEmail(context, session, typed.email)
  const payment =
    plan && session.mode === "subscription"
      ? subscribeSession(context, session, plan, email)
      : plan && session.mode !== "setup"
        ? chargeSession(context, session, plan, { email, card: typed.card })
        : { payment_status: "no_payment_required" as const }

  if ("declined" in payment) return payment

  const completed = context.objects.checkoutSessions.change(session.id, {
    ...payment,
    status: "complete",
    customer_details: { ...emptyDetails(), email },
  })

  if (completed) context.events.emit("checkout.session.completed", completed)

  return completed ?? session
}

function emptyDetails(): NonNullable<CheckoutSession["customer_details"]> {
  return {
    address: null,
    business_name: null,
    email: null,
    individual_name: null,
    name: null,
    phone: null,
    tax_exempt: "none",
    tax_ids: [],
  }
}

/** Where the browser goes after paying, with `{CHECKOUT_SESSION_ID}` filled in. */
function successRedirect(c: Context, session: CheckoutSession): Response {
  if (!session.success_url)
    return c.html(messagePage("Payment complete", "You can close this window."))

  return c.redirect(session.success_url.replaceAll("{CHECKOUT_SESSION_ID}", session.id), 303)
}

/** Marks an open session past its `expires_at` as expired. Returns the session as it is now. */
function settleExpiry(context: StripeRouteContext, session: CheckoutSession): CheckoutSession {
  if (session.status !== "open" || unix(context.clock()) < session.expires_at) return session

  const expired = context.objects.checkoutSessions.change(session.id, {
    status: "expired",
    url: null,
  })

  if (expired) context.events.emit("checkout.session.expired", expired)

  return expired ?? session
}

/** The checkout a page link names, with expiry applied, or the page to show when it can't be paid. */
function payableCheckout(
  context: StripeRouteContext,
  c: Context,
  id: string,
): CheckoutSession | Response {
  const found = context.objects.checkoutSessions.get(id)

  if (!found)
    return c.html(messagePage("Checkout not found", "This checkout link is not valid."), 404)

  const session = settleExpiry(context, found)

  if (session.status === "expired")
    return c.html(messagePage("Checkout expired", "This checkout link has expired."), 410)

  return session
}

/** The hosted payment page for an open session; after a decline, `after` says why. */
function payPage(
  context: StripeRouteContext,
  session: CheckoutSession,
  after: { readonly error?: string; readonly card?: string } = {},
): string {
  const lines = context.objects.checkoutSessions.extra(session.id)?.lines ?? []

  return renderPayPage({
    sessionId: session.id,
    lines: lines.map((line) => ({
      description: line.description,
      quantity: line.quantity,
      amount: line.unitAmount * line.quantity,
    })),
    total: session.amount_total ?? 0,
    currency: session.currency ?? "usd",
    email: session.customer_email,
    cancelUrl: session.cancel_url,
    ...after,
  })
}

/** Checkout Sessions over the API, plus the hosted payment page they send customers to. */
export function checkoutSessionRoutes(context: StripeRouteContext): void {
  const { app, objects, events } = context
  const sessions = objects.checkoutSessions

  app.post("/v1/checkout/sessions", (c) => createSession(c, context))

  app.get("/v1/checkout/sessions/:id", (c) => {
    const id = c.req.param("id")
    const session = sessions.get(id)

    return session ? c.json(settleExpiry(context, session)) : noSuch(c, "checkout.session", id)
  })

  app.post("/v1/checkout/sessions/:id/expire", (c) => {
    const id = c.req.param("id")
    const session = sessions.get(id)

    if (!session) return noSuch(c, "checkout.session", id)
    if (session.status !== "open")
      return stripeError(
        c,
        400,
        "invalid_request_error",
        `Only Checkout Sessions with a status of open can be expired. This Checkout Session has a status of ${session.status}.`,
      )

    const expired = sessions.change(id, { status: "expired", url: null })

    if (expired) events.emit("checkout.session.expired", expired)

    return c.json(expired)
  })

  app.get("/v1/checkout/sessions", (c) => {
    const filters = ["payment_intent", "customer", "status", "payment_status"] as const
    const wanted = filters.map((name) => [name, c.req.query(name)] as const)

    return listPage(
      c,
      sessions.where((session) =>
        wanted.every(([name, value]) => value === undefined || session[name] === value),
      ),
      "/v1/checkout/sessions",
    )
  })

  app.get("/checkout/:id", (c) => {
    const session = payableCheckout(context, c, c.req.param("id"))

    if (session instanceof Response) return session
    if (session.status === "complete")
      return c.html(messagePage("Already paid", "This checkout is complete."))

    return c.html(payPage(context, session))
  })

  app.post("/checkout/:id/complete", async (c) => {
    const session = payableCheckout(context, c, c.req.param("id"))

    if (session instanceof Response) return session
    if (session.status === "complete") return successRedirect(c, session)

    const form = await c.req.parseBody()
    const email = typeof form.email === "string" ? form.email : null
    const typed = typeof form.card === "string" ? form.card : null
    /* `danwo matrix` asks for a decline whatever card was typed. */
    const card =
      c.req.header(EMULATE_HEADER) === CARD_DECLINED
        ? "pm_card_chargeDeclined"
        : checkoutCardFor(typed)
    const paid = paySession(context, session, { email, card })

    if ("declined" in paid)
      return c.html(
        payPage(context, session, { error: paid.declined, ...(typed !== null && { card: typed }) }),
        402,
      )

    return successRedirect(c, paid)
  })
}
