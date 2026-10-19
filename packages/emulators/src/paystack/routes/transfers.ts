import type { Context } from "../../http.ts"
import { requireIntegration } from "../auth.ts"
import type { PaystackRouteContext } from "../context.ts"
import type { Integration, KnownAccount, Recipient, Transfer } from "../entities.ts"
import { recipientObject, transferObject } from "../formatters.ts"
import { amountOf, bodyOf, fail, newReference, nextId, ok, pageOf, text } from "../helpers.ts"
import { PROBLEMS } from "../problems.ts"
import { emitEvent } from "../signature.ts"

/** How long a transfer stays pending before the bank answers. */
const SETTLES_AFTER_MS = 1000

/** The OTP a transfer asks for when the integration has transfer OTPs on, as in test mode. */
export const TRANSFER_OTP = "123456"

/** What a transfer to a bank account ends as: what the seed says about that account, else success. */
function outcomeFor(context: PaystackRouteContext, transfer: Transfer) {
  const { bank_code, account_number } = transfer.recipient.details

  return (
    context.paystack.accounts.get(`${bank_code}:${account_number}`)?.transferOutcome ?? "success"
  )
}

function balanceOf(
  context: PaystackRouteContext,
  integration: Integration,
  currency: string,
): number {
  return context.paystack.integrations.extra(integration.id)?.balance[currency] ?? 0
}

function adjustBalance(
  context: PaystackRouteContext,
  integration: Integration,
  currency: string,
  delta: number,
): void {
  const balance = context.paystack.integrations.extra(integration.id)?.balance ?? {}

  context.paystack.integrations.setExtra(integration.id, {
    balance: { ...balance, [currency]: (balance[currency] ?? 0) + delta },
  })
}

/** Settles a pending transfer on the clock: success, or failed or reversed with the money back. */
function settleLater(context: PaystackRouteContext, integration: Integration, code: string): void {
  context.timer.setTimeout(() => {
    const transfer = context.paystack.transfers.get(code)

    if (transfer?.status !== "pending") return

    const outcome = outcomeFor(context, transfer)
    const now = context.clock().toISOString()
    const settled = context.paystack.transfers.change(code, {
      status: outcome,
      transferred_at: outcome === "success" ? now : null,
      updatedAt: now,
    })

    if (outcome !== "success")
      adjustBalance(context, integration, transfer.currency, transfer.amount)

    emitEvent(context.outbox, `transfer.${outcome}`, settled)
  }, SETTLES_AFTER_MS)
}

/** The name a recipient goes by: the one sent, else the bank's name for the account. */
function namesOf(fields: Record<string, unknown>, known: KnownAccount | undefined) {
  const given = text(fields, "name")
  const accountName = known?.accountName ?? (given ?? "TEST ACCOUNT").toUpperCase()

  return { name: given ?? accountName, accountName }
}

async function createRecipient(c: Context, context: PaystackRouteContext): Promise<Response> {
  const integration = requireIntegration(c, context.paystack)
  const fields = await bodyOf(c)
  const bank = context.paystack.banks.get(text(fields, "bank_code") ?? "")
  const number = text(fields, "account_number") ?? ""

  if (bank === undefined) return fail(c, 400, "Bank is invalid", PROBLEMS.invalidBankCode)
  if (!/^\d{10}$/.test(number)) return fail(c, 400, "Account number is invalid")

  const recipient = context.paystack.recipients.add(
    recipientObject({
      id: nextId(context.store),
      type: text(fields, "type") ?? "nuban",
      currency: text(fields, "currency") ?? "NGN",
      accountNumber: number,
      ...namesOf(fields, context.paystack.accounts.get(`${bank.code}:${number}`)),
      bank,
      integration,
      now: context.clock(),
    }),
    null,
  )

  return c.json(
    { status: true, message: "Transfer recipient created successfully", data: recipient },
    201,
  )
}

/** What stops a transfer from starting, as Paystack words it; undefined when it can go. */
function transferProblem(
  context: PaystackRouteContext,
  integration: Integration,
  request: { recipient: Recipient | undefined; amount: number | undefined; reference: string },
): string | undefined {
  const { recipient, amount, reference } = request

  if (recipient === undefined) return "Recipient specified is invalid"
  if (amount === undefined) return "Invalid amount"
  if (context.paystack.transfers.where((t) => t.reference === reference).length > 0)
    return "Duplicate Transfer Reference"

  return balanceOf(context, integration, recipient.currency) < amount
    ? "Your balance is not enough to fulfil this request"
    : undefined
}

/** Takes the amount from the balance and stores the transfer, waiting for an OTP or the bank. */
function startTransfer(
  context: PaystackRouteContext,
  integration: Integration,
  request: { amount: number; recipient: Recipient; reference: string; reason: string | null },
): Transfer {
  adjustBalance(context, integration, request.recipient.currency, -request.amount)

  return context.paystack.transfers.add(
    transferObject({
      id: nextId(context.store),
      ...request,
      currency: request.recipient.currency,
      status: integration.transferOtp ? "otp" : "pending",
      integration,
      now: context.clock(),
    }),
    null,
  )
}

async function initiate(c: Context, context: PaystackRouteContext): Promise<Response> {
  const { paystack } = context
  const integration = requireIntegration(c, paystack)
  const fields = await bodyOf(c)
  const recipient = paystack.recipients.get(text(fields, "recipient") ?? "")
  const amount = amountOf(fields)
  const reference = text(fields, "reference") ?? newReference()
  const problem = transferProblem(context, integration, { recipient, amount, reference })

  if (problem !== undefined || recipient === undefined || amount === undefined)
    return fail(c, 400, problem ?? "Invalid request")

  const transfer = startTransfer(context, integration, {
    amount,
    recipient,
    reference,
    reason: text(fields, "reason") ?? null,
  })

  if (transfer.status === "otp") return ok(c, "Transfer requires OTP to continue", transfer)

  settleLater(context, integration, transfer.transfer_code)

  return ok(c, "Transfer has been queued", transfer)
}

async function finalize(c: Context, context: PaystackRouteContext): Promise<Response> {
  const integration = requireIntegration(c, context.paystack)
  const fields = await bodyOf(c)
  const code = text(fields, "transfer_code") ?? ""
  const transfer = context.paystack.transfers.get(code)

  if (transfer?.status !== "otp") return fail(c, 400, "Transfer is not currently awaiting OTP")
  if (text(fields, "otp") !== TRANSFER_OTP) return fail(c, 400, "Invalid OTP")

  const pending = context.paystack.transfers.change(code, { status: "pending" })

  settleLater(context, integration, code)

  return ok(c, "Transfer has been queued", pending)
}

/** Transfer recipients, transfers out of the balance (settling on the clock), and the balance. */
export function transferRoutes(context: PaystackRouteContext): void {
  const { app, paystack } = context

  app.post("/transferrecipient", (c) => createRecipient(c, context))
  app.get("/transferrecipient", (c) => {
    const integration = requireIntegration(c, paystack)
    const { data, meta } = pageOf(
      c,
      paystack.recipients.where((r) => r.integration === integration.number),
    )

    return ok(c, "Recipients retrieved", data, { meta })
  })

  app.post("/transfer", (c) => initiate(c, context))
  app.post("/transfer/finalize_transfer", (c) => finalize(c, context))

  app.get("/transfer", (c) => {
    const integration = requireIntegration(c, paystack)
    const { data, meta } = pageOf(
      c,
      paystack.transfers.where((t) => t.integration === integration.number),
    )

    return ok(c, "Transfers retrieved", data, { meta })
  })

  app.get("/transfer/verify/:reference", (c) => {
    const reference = c.req.param("reference")
    const transfer = paystack.transfers.where((t) => t.reference === reference)[0]

    return transfer
      ? ok(c, "Transfer retrieved", transfer)
      : fail(c, 404, "Transfer ID/code specified is invalid", PROBLEMS.invalidParams)
  })

  app.get("/transfer/:code", (c) => {
    const key = c.req.param("code")
    const transfer =
      paystack.transfers.get(key) ?? paystack.transfers.where((t) => String(t.id) === key)[0]

    return transfer
      ? ok(c, "Transfer retrieved", transfer)
      : fail(c, 404, "Transfer ID/code specified is invalid", PROBLEMS.invalidParams)
  })

  app.get("/balance", (c) => {
    const integration = requireIntegration(c, paystack)
    const balance = paystack.integrations.extra(integration.id)?.balance ?? {}

    return ok(
      c,
      "Balances retrieved",
      Object.entries(balance).map(([currency, amount]) => ({ currency, balance: amount })),
    )
  })
}
