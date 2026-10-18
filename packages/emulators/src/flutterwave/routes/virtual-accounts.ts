/**
 * Virtual account numbers: a dynamic account for one payment, or a permanent one for a customer.
 * Money arrives through `flutterwaveBank(emulator).transferIn(...)`, which pays the account like a
 * customer's bank transfer and sends `charge.completed`.
 */
import { HttpError } from "../../errors.ts"
import type { FlutterwaveRouteContext } from "../context.ts"
import type { VirtualAccount } from "../entities.ts"
import {
  amountOf,
  appFee,
  failure,
  hex,
  jsonBody,
  money,
  plainTime,
  required,
  success,
  text,
} from "../helpers.ts"

/** A ten-digit account number that no other virtual account has. */
function freshAccountNumber(context: FlutterwaveRouteContext): string {
  const taken = new Set(
    context.flutterwave.virtualAccounts.all().map((account) => account.account_number),
  )

  for (;;) {
    const number = `95${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`

    if (!taken.has(number)) return number
  }
}

function newVirtualAccount(
  context: FlutterwaveRouteContext,
  body: Record<string, unknown>,
): { account: VirtualAccount; permanent: boolean } {
  const permanent = body["is_permanent"] === true
  const amount = amountOf(body, "amount")
  const now = context.clock()

  if (permanent && text(body, "bvn") === undefined)
    throw new HttpError(400, "BVN is required for static account number generation")
  if (!permanent && amount === undefined)
    throw new HttpError(400, "amount is required for a dynamic virtual account")

  const expiry = permanent ? "N/A" : plainTime(new Date(now.getTime() + 3_600_000))
  const charged = amount === undefined ? 0 : money(amount + appFee(amount))

  return {
    permanent,
    account: {
      response_code: "02",
      response_message: "Transaction in progress",
      flw_ref: `${hex(4).toUpperCase()}${now.getTime()}`,
      order_ref: `URF_${now.getTime()}_${hex(3)}`,
      account_number: freshAccountNumber(context),
      frequency: permanent ? "N/A" : "1",
      bank_name: "Flutterwave MFB",
      created_at: plainTime(now),
      expiry_date: expiry,
      note: `Please make a bank transfer to ${text(body, "narration") ?? "Merchant"}`,
      amount: charged.toFixed(2),
    },
  }
}

export function virtualAccountRoutes(context: FlutterwaveRouteContext): void {
  const { app, flutterwave } = context

  app.post("/v3/virtual-account-numbers", async (c) => {
    const body = await jsonBody(c)
    const email = required(body, "email")
    const { account, permanent } = newVirtualAccount(context, body)
    const name = [text(body, "firstname"), text(body, "lastname")].filter(Boolean).join(" ")

    flutterwave.virtualAccounts.add(account, {
      txRef: text(body, "tx_ref") ?? account.order_ref,
      email,
      name,
      permanent,
    })

    return success(c, "Virtual account created", account)
  })

  app.get("/v3/virtual-account-numbers/:order_ref", (c) => {
    const account = flutterwave.virtualAccounts.get(c.req.param("order_ref"))

    return account
      ? success(c, "Virtual account fetched", account)
      : failure(c, 404, "Virtual account not found")
  })
}
