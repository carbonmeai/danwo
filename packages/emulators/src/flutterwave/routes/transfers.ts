/**
 * Payouts: transfers to bank accounts (with test-mode references deciding how they end), their
 * retries and fees, beneficiaries, banks, account name lookups and balances.
 */
import { HttpError } from "../../errors.ts"
import type { Context } from "../../http.ts"
import type { FlutterwaveRouteContext } from "../context.ts"
import type { KnownAccount, Transfer } from "../entities.ts"
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
  transferFee,
} from "../helpers.ts"

/** The account at `bank` with `number`, or a 400 when Flutterwave cannot name it. */
function resolveAccount(
  context: FlutterwaveRouteContext,
  bank: string,
  number: string,
): KnownAccount {
  const known = context.flutterwave.accounts.get(`${bank}:${number}`)

  if (known === undefined)
    throw new HttpError(400, "Sorry, recipient account could not be validated. Please try again")

  return known
}

/** The name of the bank with `code`, from any seeded country. */
function bankName(context: FlutterwaveRouteContext, code: string): string {
  return (
    context.flutterwave.banks.where((seeded) => seeded.bank.code === code)[0]?.bank.name ?? code
  )
}

/** Takes `amount` from the balance in `currency`, or answers 400 when it does not cover it. */
function debit(context: FlutterwaveRouteContext, currency: string, amount: number): void {
  const { balances } = context.flutterwave
  const balance = balances.get(currency)

  if (balance === undefined || balance.available_balance < amount)
    throw new HttpError(400, "Insufficient funds in your wallet to make this transfer")

  balances.change(currency, {
    available_balance: balance.available_balance - amount,
    ledger_balance: balance.ledger_balance - amount,
  })
}

/** A queued transfer from a `POST /v3/transfers` body. */
function newTransfer(context: FlutterwaveRouteContext, body: Record<string, unknown>): Transfer {
  const bank = required(body, "account_bank")
  const number = required(body, "account_number")
  const amount = amountOf(body, "amount")
  const currency = (text(body, "currency") ?? "NGN").toUpperCase()

  if (amount === undefined || amount <= 0) throw new HttpError(400, "amount is required")

  const account = resolveAccount(context, bank, number)

  if (account.blacklisted)
    throw new HttpError(400, "Payout was made to a blacklisted account number")

  const fee = transferFee(currency)

  debit(context, currency, amount + fee)

  return {
    id: nextId(context.store),
    account_number: number,
    bank_code: bank,
    full_name: text(body, "beneficiary_name") ?? account.accountName,
    created_at: isoTime(context.clock()),
    currency,
    debit_currency: (text(body, "debit_currency") ?? currency).toUpperCase(),
    amount,
    fee,
    status: "NEW",
    reference: text(body, "reference") ?? `flw-${hex(8)}`,
    meta: null,
    narration: text(body, "narration") ?? "",
    complete_message: "",
    requires_approval: 0,
    is_approved: 1,
    bank_name: bankName(context, bank),
  }
}

function beneficiaryRoutes(context: FlutterwaveRouteContext): void {
  const { app, flutterwave } = context

  app.post("/v3/beneficiaries", async (c) => {
    const body = await jsonBody(c)
    const bank = required(body, "account_bank")
    const number = required(body, "account_number")
    const account = resolveAccount(context, bank, number)
    const beneficiary = flutterwave.beneficiaries.add(
      {
        id: nextId(context.store),
        account_number: number,
        bank_code: bank,
        full_name: text(body, "beneficiary_name") ?? account.accountName,
        created_at: isoTime(context.clock()),
        bank_name: bankName(context, bank),
      },
      null,
    )

    return success(c, "Beneficiary created", beneficiary)
  })

  app.get("/v3/beneficiaries", (c) => {
    const page = pageOf(c, flutterwave.beneficiaries.all().toReversed())

    return success(c, "Beneficiaries fetched", page.data, page.meta)
  })

  app.get("/v3/beneficiaries/:id", (c) => {
    const found = flutterwave.beneficiaries.get(c.req.param("id"))

    return found
      ? success(c, "Beneficiary fetched", found)
      : failure(c, 404, "Beneficiary not found")
  })

  app.delete("/v3/beneficiaries/:id", (c) =>
    flutterwave.beneficiaries.remove(c.req.param("id"))
      ? success(c, "Beneficiary deleted", "Deleted")
      : failure(c, 404, "Beneficiary not found"),
  )
}

function lookupRoutes(context: FlutterwaveRouteContext): void {
  const { app, flutterwave } = context

  app.get("/v3/banks/:country", (c) => {
    const country = c.req.param("country").toUpperCase()

    return success(
      c,
      "Banks fetched successfully",
      flutterwave.banks.where((seeded) => seeded.country === country).map((seeded) => seeded.bank),
    )
  })

  app.post("/v3/accounts/resolve", async (c) => {
    const body = await jsonBody(c)
    const account = resolveAccount(
      context,
      required(body, "account_bank"),
      required(body, "account_number"),
    )

    return success(c, "Account details fetched", {
      account_number: account.accountNumber,
      account_name: account.accountName,
    })
  })

  app.get("/v3/balances", (c) => success(c, "Wallet balances fetched", flutterwave.balances.all()))

  app.get("/v3/balances/:currency", (c) => {
    const balance = flutterwave.balances.get(c.req.param("currency").toUpperCase())

    return balance
      ? success(c, "Wallet balance fetched", balance)
      : failure(c, 400, "Invalid currency")
  })
}

/** A transfer by the `:id` in the path. */
function transferOf(context: FlutterwaveRouteContext, c: Context): Transfer | undefined {
  return context.flutterwave.transfers.get(c.req.param("id"))
}

function retryRoutes(context: FlutterwaveRouteContext, events: FlutterwaveEvents): void {
  const { app, flutterwave } = context

  app.post("/v3/transfers/:id/retries", (c) => {
    const original = transferOf(context, c)
    const extra = original && flutterwave.transfers.extra(String(original.id))

    if (original === undefined || extra === undefined) return failure(c, 404, "Transfer not found")
    if (original.status !== "FAILED") return failure(c, 400, "Only failed transfers can be retried")

    debit(context, original.currency, original.amount + original.fee)

    const retry = flutterwave.transfers.add(
      {
        ...original,
        id: nextId(context.store),
        status: "NEW",
        created_at: isoTime(context.clock()),
      },
      { callbackUrl: extra.callbackUrl, retries: [] },
    )

    flutterwave.transfers.setExtra(String(original.id), {
      ...extra,
      retries: [...extra.retries, retry.id],
    })
    events.scheduleTransfer(retry)

    return success(c, "Transfer retry attempt queued.", retry)
  })

  app.get("/v3/transfers/:id/retries", (c) => {
    const original = transferOf(context, c)
    const retries =
      original === undefined ? undefined : flutterwave.transfers.extra(String(original.id))?.retries

    if (retries === undefined) return failure(c, 404, "Transfer not found")

    return success(
      c,
      "Transfer retry attempts fetched.",
      retries
        .map((id) => flutterwave.transfers.get(String(id)))
        .filter((transfer) => transfer !== undefined),
    )
  })
}

export function transferRoutes(context: FlutterwaveRouteContext, events: FlutterwaveEvents): void {
  const { app, flutterwave } = context

  app.post("/v3/transfers", async (c) => {
    const body = await jsonBody(c)
    const transfer = flutterwave.transfers.add(newTransfer(context, body), {
      callbackUrl: text(body, "callback_url") ?? null,
      retries: [],
    })

    events.scheduleTransfer(transfer)

    return success(c, "Transfer Queued Successfully", transfer)
  })

  app.get("/v3/transfers/fee", (c) => {
    const currency = (c.req.query("currency") ?? "NGN").toUpperCase()

    return success(c, "Transfer fee fetched", [
      { currency, fee_type: "value", fee: transferFee(currency) },
    ])
  })

  app.get("/v3/transfers/:id", (c) => {
    const transfer = transferOf(context, c)

    return transfer
      ? success(c, "Transfer fetched", transfer)
      : failure(c, 404, "Transfer not found")
  })

  app.get("/v3/transfers", (c) => {
    const status = c.req.query("status")
    const matching = flutterwave.transfers
      .where((transfer) => status === undefined || transfer.status === status.toUpperCase())
      .toReversed()
    const page = pageOf(c, matching)

    return success(c, "Transfers fetched", page.data, page.meta)
  })

  retryRoutes(context, events)
  beneficiaryRoutes(context)
  lookupRoutes(context)
}
