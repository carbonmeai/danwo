import { debit, exchangeRate } from "../balance.ts"
import type { BachsContext } from "../context.ts"
import type { Payout, PayoutDestination, PayoutQuote } from "../entities.ts"
import { destinationObject, payoutEventData, payoutObject, quoteObject } from "../formatters.ts"
import {
  bachsId,
  BachsFailure,
  bodyOf,
  invalid,
  iso,
  later,
  minorOf,
  notFound,
  pagingOf,
  text,
} from "../helpers.ts"
import { SETTLE_OUT_MS } from "../money-out.ts"

/** How long a payout quote holds its rate. */
const QUOTE_MS = 30_000

/** An account number that marks a destination the emulator rejects on review. */
const REJECTED_ACCOUNT = "0000000000"

/** The withdrawal fee: 0.5% of what leaves the balance. */
function feeOf(amount: number): number {
  return Math.round(amount * 0.005)
}

/** A destination from a create request, approved at once unless its account number is the rejected one. */
function newDestination(context: BachsContext, body: Record<string, unknown>): PayoutDestination {
  const currency = text(body, "currency")?.toUpperCase()

  if (!currency)
    invalid("Missing required field(s): currency", {
      field: "currency",
      message: "Field required",
      type: "missing",
    })

  const type = text(body, "type") ?? text(body, "destination_type")

  if (!type) throw new BachsFailure(400, "DESTINATION_TYPE_REQUIRED", "type is required")

  const field = (key: string) => text(body, key) ?? null
  const accountNumber = field("account_number")
  const now = iso(context.clock())

  return {
    id: bachsId("pd", 14),
    name: field("name") ?? field("label") ?? `${currency} ${type}`,
    type,
    currency,
    status: accountNumber === REJECTED_ACCOUNT ? "rejected" : "approved",
    accountNumber,
    accountName: field("account_name") ?? (accountNumber ? "DANWO TEST ACCOUNT" : null),
    bankCode: field("bank_code"),
    bankName: field("bank_name"),
    phoneNumber: field("phone_number"),
    mobileProvider: field("mobile_provider"),
    walletAddress: field("wallet_address"),
    network: field("network"),
    fails: false,
    createdAt: now,
    updatedAt: now,
  }
}

/** A quote converting `amount` of one currency into another, valid for 30 seconds. */
function newQuote(context: BachsContext, body: Record<string, unknown>): PayoutQuote {
  const from = text(body, "from_currency")?.toUpperCase()
  const to = text(body, "to_currency")?.toUpperCase()
  const amount = minorOf(body["amount"])

  if (!from || !to || amount === undefined)
    invalid("from_currency, to_currency and amount are required")

  const rate = exchangeRate(from, to)

  if (rate === undefined)
    throw new BachsFailure(400, "QUOTE_NOT_APPLICABLE", `No conversion from ${from} to ${to}`)

  return {
    id: bachsId("quote", 14),
    fromCurrency: from,
    toCurrency: to,
    fromAmount: amount,
    toAmount: Math.round(amount * rate),
    rate: rate.toFixed(rate >= 1 ? 2 : 6),
    expiresAt: iso(later(context.clock(), QUOTE_MS)),
  }
}

/** A usable destination by id, or the reason it cannot be paid. */
function usableDestination(context: BachsContext, id: string | undefined): PayoutDestination {
  const destination = id ? context.bachs.destinations.get(id) : undefined

  if (!destination)
    throw new BachsFailure(404, "DESTINATION_NOT_FOUND", `Destination ${id ?? ""} not found`)
  if (destination.status === "rejected")
    throw new BachsFailure(400, "DESTINATION_REJECTED", "The destination was rejected on review")
  if (destination.status !== "approved")
    throw new BachsFailure(
      400,
      "DESTINATION_PENDING_REVIEW",
      "The destination is still under review",
    )

  return destination
}

/** What a payout moves: a same-currency amount, or a quote's conversion. */
function amountsOf(
  context: BachsContext,
  body: Record<string, unknown>,
  destination: PayoutDestination,
) {
  const quoteId = text(body, "quote_id")

  if (quoteId && body["amount"] !== undefined)
    throw new BachsFailure(
      400,
      "AMOUNT_NOT_ALLOWED_WITH_QUOTE",
      "Send either amount or quote_id, not both",
    )

  if (!quoteId) {
    const amount = minorOf(body["amount"])

    if (amount === undefined) throw new BachsFailure(400, "AMOUNT_REQUIRED", "amount is required")

    return { sourceCurrency: destination.currency, sourceAmount: amount, amount, rate: null }
  }

  const quote = context.bachs.quotes.get(quoteId)

  if (!quote) throw new BachsFailure(400, "QUOTE_NOT_FOUND", "The quote does not exist")
  if (Date.parse(quote.expiresAt) <= context.clock().getTime())
    throw new BachsFailure(400, "QUOTE_EXPIRED", "The quote has lapsed")
  if (quote.toCurrency !== destination.currency)
    throw new BachsFailure(
      400,
      "QUOTE_DESTINATION_MISMATCH",
      "The quote's currency does not match the destination",
    )

  return {
    sourceCurrency: quote.fromCurrency,
    sourceAmount: quote.fromAmount,
    amount: quote.toAmount,
    rate: quote.rate,
  }
}

/** A payout from a create request: its money taken from the balance, before it is stored. */
function newPayout(context: BachsContext, body: Record<string, unknown>): Payout {
  const destination = usableDestination(context, text(body, "destination"))
  const amounts = amountsOf(context, body, destination)
  const fee = feeOf(amounts.sourceAmount)

  debit(context.bachs, amounts.sourceCurrency, amounts.sourceAmount + fee, "payout")

  const now = context.clock()

  return {
    id: bachsId("pay", 16),
    destinationId: destination.id,
    status: "processing",
    ...amounts,
    currency: destination.currency,
    fee,
    reference: text(body, "reference") ?? null,
    failureReason: null,
    metadata: null,
    settlesAt: iso(later(now, SETTLE_OUT_MS)),
    createdAt: iso(now),
    completedAt: null,
  }
}

/** Payout destinations, quotes and payouts. */
export function payoutRoutes(context: BachsContext): void {
  const { app, bachs } = context
  const destination = (id: string) => bachs.destinations.get(id) ?? notFound("Destination")

  app.post("/v1/payouts/destinations", async (c) =>
    c.json(
      destinationObject(bachs.destinations.add(newDestination(context, await bodyOf(c)), null)),
      201,
    ),
  )

  app.get("/v1/payouts/destinations", (c) => {
    const { limit, offset } = pagingOf(c)
    const currency = c.req.query("currency")
    const status = c.req.query("status")
    const all = bachs.destinations.where(
      (d) => (!currency || d.currency === currency) && (!status || d.status === status),
    )

    return c.json({
      destinations: all.slice(offset, offset + limit).map(destinationObject),
      total: all.length,
      limit,
      offset,
    })
  })

  app.get("/v1/payouts/destinations/:id", (c) =>
    c.json(destinationObject(destination(c.req.param("id")))),
  )

  app.patch("/v1/payouts/destinations/:id", async (c) => {
    const found = destination(c.req.param("id"))
    const name = text(await bodyOf(c), "name")

    return c.json(
      destinationObject(
        bachs.destinations.change(found.id, {
          ...(name && { name }),
          updatedAt: iso(context.clock()),
        }) ?? found,
      ),
    )
  })

  app.delete("/v1/payouts/destinations/:id", (c) => {
    bachs.destinations.remove(destination(c.req.param("id")).id)

    return c.body(null, 204)
  })

  app.post("/v1/payouts/quotes", async (c) =>
    c.json(quoteObject(bachs.quotes.add(newQuote(context, await bodyOf(c)), null)), 201),
  )

  app.post("/v1/payouts", async (c) => {
    const payout = bachs.payouts.add(newPayout(context, await bodyOf(c)), null)

    context.events.emit("payout.created", payoutEventData(payout))
    context.wakeAt(new Date(payout.settlesAt ?? payout.createdAt))

    return c.json(payoutObject(payout), 201)
  })

  app.get("/v1/payouts/:id", (c) =>
    c.json(payoutObject(bachs.payouts.get(c.req.param("id")) ?? notFound("Payout"))),
  )

  app.get("/v1/payouts", (c) => {
    const { limit, offset } = pagingOf(c)
    const status = c.req.query("status_filter")
    const all = bachs.payouts.where((p) => !status || p.status === status).toReversed()

    return c.json({ total: all.length, items: all.slice(offset, offset + limit).map(payoutObject) })
  })
}
