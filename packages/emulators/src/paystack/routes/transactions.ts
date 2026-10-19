import type { Context } from "../../http.ts"
import { requireIntegration } from "../auth.ts"
import type { PaystackRouteContext } from "../context.ts"
import { type Integration, type Transaction, TRANSACTION_STATUSES } from "../entities.ts"
import {
  amountOf,
  bodyOf,
  CHECKOUT_BASE,
  currencyOf,
  fail,
  metadataOf,
  ok,
  pageOf,
  text,
} from "../helpers.ts"
import type { PaystackPayments } from "../payments.ts"
import { PROBLEMS } from "../problems.ts"
import type { PaystackStore } from "../store.ts"

/** The integration's transactions, oldest first. */
export function transactionsOf(paystack: PaystackStore, integration: Integration): Transaction[] {
  return paystack.transactions.where(
    (transaction) =>
      paystack.customers.get(transaction.customer.customer_code)?.integration ===
      integration.number,
  )
}

const INVALID_AMOUNT = "Invalid Amount Sent"

/** References may hold letters, digits, `-`, `.` and `=`, as Paystack allows. */
function validReference(reference: string | undefined): boolean {
  return reference === undefined || /^[A-Za-z0-9.=-]+$/.test(reference)
}

/** What makes an initialize call unusable, as Paystack words it; undefined when it is fine. */
function initializeProblem(
  context: PaystackRouteContext,
  fields: Record<string, unknown>,
): string | undefined {
  const reference = text(fields, "reference")
  const plan = text(fields, "plan")

  if (!(text(fields, "email") ?? "").includes("@")) return "Invalid Email Address Passed"
  if (plan === undefined)
    return amountOf(fields) === undefined ? INVALID_AMOUNT : referenceProblem(context, reference)
  if (context.paystack.plans.get(plan) === undefined) return "Plan not found"

  return referenceProblem(context, reference)
}

/** Why a caller's reference cannot be used: its characters, or an earlier transaction has it. */
function referenceProblem(
  context: PaystackRouteContext,
  reference: string | undefined,
): string | undefined {
  if (reference === undefined) return undefined
  if (!validReference(reference)) return "Invalid transaction reference"

  return context.paystack.transactions.get(reference)
    ? "Duplicate Transaction Reference"
    : undefined
}

function channelsOf(fields: Record<string, unknown>): readonly string[] {
  const given = fields["channels"]

  return Array.isArray(given)
    ? given.filter((channel): channel is string => typeof channel === "string")
    : ["card", "bank_transfer", "ussd"]
}

async function initialize(
  c: Context,
  context: PaystackRouteContext,
  payments: PaystackPayments,
): Promise<Response> {
  const integration = requireIntegration(c, context.paystack)
  const fields = await bodyOf(c)
  const problem = initializeProblem(context, fields)
  const currency = currencyOf(fields, integration.currency === "GHS" ? "GHS" : "NGN")

  if (problem !== undefined)
    return fail(c, 400, problem, problem === INVALID_AMOUNT ? PROBLEMS.invalidAmount : undefined)
  if (currency === undefined)
    return fail(c, 400, "No active channel to process transaction. Please contact merchant")

  const planCode = text(fields, "plan")
  const { transaction, extra } = payments.start({
    integration,
    email: text(fields, "email") ?? "",
    amount: amountOf(fields) ?? 0,
    currency,
    reference: text(fields, "reference"),
    metadata: metadataOf(fields["metadata"]),
    callbackUrl: text(fields, "callback_url") ?? null,
    channels: channelsOf(fields),
    plan: planCode === undefined ? null : (context.paystack.plans.get(planCode) ?? null),
  })

  return ok(c, "Authorization URL created", {
    authorization_url: `${CHECKOUT_BASE}/${extra.accessCode}`,
    access_code: extra.accessCode,
    reference: transaction.reference,
  })
}

/** Whether a transaction passes the list's `status`, `from` and `to` filters. */
function listed(c: Context, transaction: Transaction): boolean {
  const status = c.req.query("status")
  const from = Date.parse(c.req.query("from") ?? "")
  const to = Date.parse(c.req.query("to") ?? "")
  const at = Date.parse(transaction.created_at)

  return (
    (status === undefined || transaction.status === status) &&
    (Number.isNaN(from) || at >= from) &&
    (Number.isNaN(to) || at <= to)
  )
}

/** Volume and counts of the integration's successful transactions, by currency. */
function totals(paystack: PaystackStore, integration: Integration) {
  const paid = transactionsOf(paystack, integration).filter((t) => t.status === "success")
  const byCurrency = new Map<string, number>()

  for (const transaction of paid)
    byCurrency.set(
      transaction.currency,
      (byCurrency.get(transaction.currency) ?? 0) + transaction.amount,
    )

  const pending = paystack.transfers.where(
    (transfer) => transfer.integration === integration.number && transfer.status === "pending",
  )

  return {
    total_transactions: paid.length,
    unique_customers: new Set(paid.map((t) => t.customer.customer_code)).size,
    total_volume: paid.reduce((sum, t) => sum + t.amount, 0),
    total_volume_by_currency: [...byCurrency].map(([currency, amount]) => ({ currency, amount })),
    pending_transfers: pending.reduce((sum, t) => sum + t.amount, 0),
    pending_transfers_by_currency: [],
  }
}

/** The saved authorization a charge names, with its customer, when the email is that customer's. */
function savedAuthorization(paystack: PaystackStore, fields: Record<string, unknown>) {
  const code = text(fields, "authorization_code") ?? ""
  const authorization = paystack.authorizations.get(code)
  const owner = paystack.authorizations.extra(code)?.customer ?? ""
  const customer = paystack.customers.get(owner)
  const email = text(fields, "email")?.toLowerCase()

  if (authorization === undefined || customer === undefined || customer.email !== email)
    return undefined

  return { authorization, customer }
}

async function chargeAuthorization(
  c: Context,
  context: PaystackRouteContext,
  payments: PaystackPayments,
): Promise<Response> {
  const integration = requireIntegration(c, context.paystack)
  const fields = await bodyOf(c)
  const saved = savedAuthorization(context.paystack, fields)

  if (saved === undefined)
    return fail(c, 400, "Authorization code is invalid", PROBLEMS.invalidAuthorizationCode)
  if (amountOf(fields) === undefined)
    return fail(c, 400, "Invalid Amount Sent", PROBLEMS.invalidAmount)

  const { authorization, customer } = saved

  const charged = payments.chargeSaved(
    {
      integration,
      email: customer.email,
      amount: amountOf(fields) ?? 0,
      currency: currencyOf(fields, "NGN") ?? "NGN",
      reference: text(fields, "reference"),
      metadata: metadataOf(fields["metadata"]),
      callbackUrl: null,
      channels: ["card"],
      plan: null,
    },
    authorization,
  )

  return ok(c, "Charge attempted", charged)
}

/** Transactions: initialize, verify, list, totals, fetch, and charging a saved card. */
export function transactionRoutes(context: PaystackRouteContext, payments: PaystackPayments): void {
  const { app, paystack } = context

  app.post("/transaction/initialize", (c) => initialize(c, context, payments))
  app.post("/transaction/charge_authorization", (c) => chargeAuthorization(c, context, payments))

  app.get("/transaction/verify/:reference", (c) => {
    const transaction = paystack.transactions.get(c.req.param("reference"))

    // Paystack answers an unknown reference as a validation error, not as a missing resource.
    if (transaction === undefined)
      return fail(c, 400, "Transaction reference not found.", PROBLEMS.transactionNotFound)

    return ok(c, "Verification successful", transaction)
  })

  app.get("/transaction/totals", (c) =>
    ok(c, "Transaction totals", totals(paystack, requireIntegration(c, paystack))),
  )

  app.get("/transaction", (c) => {
    const status = c.req.query("status")

    if (status !== undefined && !TRANSACTION_STATUSES.some((known) => known === status))
      return fail(c, 400, "Invalid status")

    const all = transactionsOf(paystack, requireIntegration(c, paystack))
    const { data, meta } = pageOf(
      c,
      all.filter((transaction) => listed(c, transaction)),
    )

    return ok(c, "Transactions retrieved", data, { meta })
  })

  app.get("/transaction/:id", (c) => {
    const id = Number(c.req.param("id"))
    const found = transactionsOf(paystack, requireIntegration(c, paystack)).find(
      (transaction) => transaction.id === id,
    )

    return found
      ? ok(c, "Transaction retrieved", found)
      : fail(c, 404, "Transaction not found", PROBLEMS.transactionNotFound)
  })
}
