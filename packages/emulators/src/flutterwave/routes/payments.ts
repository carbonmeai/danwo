/**
 * Flutterwave Standard: `POST /v3/payments` returns a hosted link, and the hosted page takes the
 * customer through the test card's authorization (PIN, OTP, address) or a bank transfer or mobile
 * money, then redirects to the link's `redirect_url` with `status`, `tx_ref` and `transaction_id`.
 */
import { HttpError } from "../../errors.ts"
import type { Context } from "../../http.ts"
import { authModel, MOBILE_MONEY_OTP, OTP_REFUSALS, phoneFails, testCard } from "../cards.ts"
import { noticePage, payPage } from "../checkout-page.ts"
import type { FlutterwaveRouteContext } from "../context.ts"
import type { LinkExtra, PaymentLink } from "../entities.ts"
import type { FlutterwaveEvents } from "../events.ts"
import {
  amountOf,
  CHECKOUT_BASE,
  failure,
  hex,
  isoTime,
  jsonBody,
  objectField,
  required,
  success,
  text,
} from "../helpers.ts"
import { cardOf, type Outcome, payLink } from "../payments.ts"

const FRESH: LinkExtra = { attempts: 0, stage: "details", card: null, phone: null, error: null }

/** Whether a transaction or a payment link already uses `txRef`. */
function referenceTaken(context: FlutterwaveRouteContext, txRef: string): boolean {
  const { links, transactions } = context.flutterwave

  return (
    links.where((link) => link.tx_ref === txRef).length > 0 ||
    transactions.where((transaction) => transaction.tx_ref === txRef).length > 0
  )
}

/** The customer a payment names; its email is required. */
function customerOf(body: Record<string, unknown>): PaymentLink["customer"] {
  const customer = objectField(body, "customer") ?? {}
  const email = text(customer, "email")

  if (email === undefined) throw new HttpError(400, "customer.email is required")

  return {
    email,
    name: text(customer, "name") ?? "",
    phone_number: text(customer, "phonenumber") ?? null,
  }
}

/** How many failed attempts the page allows and when it closes, from `configurations`. */
function limitsOf(
  context: FlutterwaveRouteContext,
  body: Record<string, unknown>,
): Pick<PaymentLink, "max_retry_attempt" | "expires_at"> {
  const settings = objectField(body, "configurations") ?? {}
  const minutes = amountOf(settings, "session_duration")
  const closes = new Date(context.clock().getTime() + Math.min(minutes ?? 0, 1440) * 60_000)

  return {
    max_retry_attempt: amountOf(settings, "max_retry_attempt") ?? null,
    expires_at: minutes === undefined ? null : isoTime(closes),
  }
}

/** The amount to charge, which must be positive. */
function chargeOf(body: Record<string, unknown>): number {
  const amount = amountOf(body, "amount")

  if (amount === undefined || amount <= 0) throw new HttpError(400, "amount is required")

  return amount
}

/** The link `POST /v3/payments` makes from its body. */
function linkFrom(context: FlutterwaveRouteContext, body: Record<string, unknown>): PaymentLink {
  const txRef = required(body, "tx_ref")
  const amount = chargeOf(body)
  const customer = customerOf(body)
  const customizations = objectField(body, "customizations") ?? {}

  if (referenceTaken(context, txRef))
    throw new HttpError(400, "A transaction with this tx_ref already exists")

  const id = `flwlnk-${hex(13)}`

  return {
    id,
    link: `${CHECKOUT_BASE}/v3/hosted/pay/${id}`,
    tx_ref: txRef,
    amount,
    currency: (text(body, "currency") ?? "NGN").toUpperCase(),
    redirect_url: required(body, "redirect_url"),
    customer,
    title: text(customizations, "title") ?? "",
    description: text(customizations, "description") ?? "",
    meta: objectField(body, "meta"),
    payment_plan: amountOf(body, "payment_plan") ?? null,
    payment_options: text(body, "payment_options") ?? "",
    ...limitsOf(context, body),
    status: "active",
  }
}

/** `url` with `params` added to its query. */
function withQuery(url: string, params: Record<string, string>): string {
  const target = new URL(url)

  for (const [name, value] of Object.entries(params)) target.searchParams.set(name, value)

  return target.toString()
}

/** Why a link cannot be paid now, as the page to show; undefined when it can. */
function unpayable(
  context: FlutterwaveRouteContext,
  link: PaymentLink | undefined,
): string | undefined {
  if (link === undefined) return noticePage("Invalid link", "This payment link is not valid.")
  if (link.status === "disabled")
    return noticePage("Link inactive", "This payment link is currently inactive.")
  if (link.status === "used")
    return noticePage("Payment complete", "This payment has been completed.")
  if (link.expires_at !== null && new Date(link.expires_at) <= context.clock())
    return noticePage("Link expired", "This payment link has expired.")

  return undefined
}

/** The page of a link again, after a step: the browser reloads it. */
function back(c: Context, link: PaymentLink): Response {
  return c.redirect(`/v3/hosted/pay/${link.id}`, 303)
}

class Checkout {
  private readonly context: FlutterwaveRouteContext
  private readonly events: FlutterwaveEvents

  constructor(context: FlutterwaveRouteContext, events: FlutterwaveEvents) {
    this.context = context
    this.events = events
  }

  /** The link and its state, or the page saying why it cannot be paid. */
  open(c: Context): { link: PaymentLink; extra: LinkExtra } | Response {
    const link = this.context.flutterwave.links.get(c.req.param("id"))
    const notice = unpayable(this.context, link)

    if (notice !== undefined || link === undefined) return c.html(notice ?? "", 404)

    return { link, extra: this.context.flutterwave.links.extra(link.id) ?? FRESH }
  }

  /** Moves the page on to `changes`. */
  step(c: Context, link: PaymentLink, extra: LinkExtra, changes: Partial<LinkExtra>): Response {
    this.context.flutterwave.links.setExtra(link.id, { ...extra, error: null, ...changes })

    return back(c, link)
  }

  /** Ends an attempt: a successful one redirects to the app, a failed one lets the customer retry. */
  finish(c: Context, link: PaymentLink, extra: LinkExtra, outcome: Outcome): Response {
    const transaction = payLink(this.context, this.events, link, outcome)
    const attempts = extra.attempts + (outcome.approved ? 0 : 1)
    const exhausted = link.max_retry_attempt !== null && attempts >= link.max_retry_attempt

    if (!outcome.approved && !exhausted)
      return this.step(c, link, extra, {
        ...FRESH,
        attempts,
        error: `${outcome.processorResponse}. Please try again.`,
      })

    this.context.flutterwave.links.change(link.id, { status: "used" })

    return c.redirect(
      withQuery(link.redirect_url, {
        status: outcome.approved ? "successful" : "failed",
        tx_ref: link.tx_ref,
        transaction_id: String(transaction.id),
      }),
    )
  }
}

/** A card's outcome once its last step passed, refused when the card is a failing test card. */
function cardOutcome(entered: LinkExtra["card"], refusal?: string): Outcome {
  const number = entered?.number ?? ""
  const card = testCard(number) ?? { network: "MASTERCARD", auth: "noauth" as const }
  const reason = refusal ?? ("refusal" in card ? card.refusal : undefined)

  return {
    approved: reason === undefined,
    processorResponse: reason ?? "Approved",
    paymentType: "card",
    authModel: authModel(card.auth),
    card: cardOf(number, card.network, entered?.expiry ?? ""),
  }
}

type StepHandler = (
  c: Context,
  form: URLSearchParams,
  state: { link: PaymentLink; extra: LinkExtra },
) => Response

function cardStep(checkout: Checkout): StepHandler {
  return (c, form, { link, extra }) => {
    const number = form.get("card_number") ?? ""
    const card = testCard(number)
    const expiry = form.get("expiry") ?? ""

    if (card === undefined)
      return checkout.step(c, link, extra, {
        error: "Card not supported. Use a Flutterwave test card.",
      })

    const entered = { ...extra, card: { number, expiry } }
    const next = { pin: "pin", "3ds": "otp", avs: "address", noauth: undefined } as const
    const stage = next[card.auth]

    return stage === undefined
      ? checkout.finish(c, link, entered, cardOutcome(entered.card))
      : checkout.step(c, link, extra, { stage, card: entered.card })
  }
}

function pinStep(checkout: Checkout): StepHandler {
  return (c, _form, { link, extra }) => {
    const card = testCard(extra.card?.number ?? "")

    if (card?.refusal === "Incorrect PIN")
      return checkout.finish(c, link, extra, cardOutcome(extra.card))

    return checkout.step(c, link, extra, { stage: "otp" })
  }
}

function otpStep(checkout: Checkout): StepHandler {
  return (c, form, { link, extra }) =>
    checkout.finish(c, link, extra, cardOutcome(extra.card, OTP_REFUSALS[form.get("otp") ?? ""]))
}

function mobileMoneyStep(checkout: Checkout): StepHandler {
  return (c, form, { link, extra }) => {
    const phone = form.get("phone") ?? ""

    if (!phoneFails(phone)) return checkout.step(c, link, extra, { stage: "mobile-otp", phone })

    return checkout.finish(c, link, extra, {
      approved: false,
      processorResponse: "Mocked a Failed Transaction",
      paymentType: "mobilemoney",
      authModel: "MOBILEMONEY",
    })
  }
}

function mobileOtpStep(checkout: Checkout): StepHandler {
  return (c, form, { link, extra }) => {
    if (form.get("otp") !== MOBILE_MONEY_OTP)
      return checkout.step(c, link, extra, { error: "Invalid OTP. Please try again." })

    return checkout.finish(c, link, extra, {
      approved: true,
      processorResponse: "Approved",
      paymentType: "mobilemoney",
      authModel: "MOBILEMONEY",
    })
  }
}

function transferStep(checkout: Checkout): StepHandler {
  return (c, _form, { link, extra }) =>
    checkout.finish(c, link, extra, {
      approved: true,
      processorResponse: "Approved",
      paymentType: "bank_transfer",
      authModel: "AUTH",
    })
}

function cancelStep(context: FlutterwaveRouteContext): StepHandler {
  return (c, _form, { link }) => {
    context.flutterwave.links.change(link.id, { status: "used" })

    return c.redirect(withQuery(link.redirect_url, { status: "cancelled", tx_ref: link.tx_ref }))
  }
}

function hostedRoutes(context: FlutterwaveRouteContext, events: FlutterwaveEvents): void {
  const checkout = new Checkout(context, events)
  const steps: Record<string, StepHandler> = {
    card: cardStep(checkout),
    pin: pinStep(checkout),
    otp: otpStep(checkout),
    address: (c, _form, { link, extra }) => checkout.step(c, link, extra, { stage: "otp" }),
    "bank-transfer": transferStep(checkout),
    "mobile-money": mobileMoneyStep(checkout),
    "mobile-otp": mobileOtpStep(checkout),
    cancel: cancelStep(context),
  }

  context.app.get("/v3/hosted/pay/:id", (c) => {
    const state = checkout.open(c)

    return state instanceof Response ? state : c.html(payPage(state.link, state.extra))
  })

  context.app.post("/v3/hosted/pay/:id/:step", async (c) => {
    const state = checkout.open(c)
    const handler = steps[c.req.param("step")]

    if (state instanceof Response) return state
    if (handler === undefined) return c.text("Not Found", 404)

    return handler(c, new URLSearchParams(await c.req.text()), state)
  })
}

export function paymentRoutes(context: FlutterwaveRouteContext, events: FlutterwaveEvents): void {
  const { app, flutterwave } = context

  app.post("/v3/payments", async (c) => {
    const link = linkFrom(context, await jsonBody(c))

    flutterwave.links.add(link, FRESH)

    return success(c, "Hosted Link", { link: link.link })
  })

  app.post("/v3/payments/link/disable", async (c) => {
    const url = required(await jsonBody(c), "link")
    const link = flutterwave.links.where((candidate) => candidate.link === url)[0]

    if (link === undefined) return failure(c, 400, "Invalid Link")
    if (link.status !== "active") return failure(c, 400, "This payment link is currently inactive")

    flutterwave.links.change(link.id, { status: "disabled" })

    return success(c, "LINK DISABLED", true)
  })

  hostedRoutes(context, events)
}
