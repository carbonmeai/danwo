import type { Context } from "../../http.ts"
import { testCard } from "../cards.ts"
import { donePage, choosePage, stepPage } from "../checkout-page.ts"
import type { PaystackRouteContext } from "../context.ts"
import type { Transaction, TransactionExtra } from "../entities.ts"
import { cardAuthorization, channelAuthorization } from "../formatters.ts"
import { text } from "../helpers.ts"
import type { PaystackPayments } from "../payments.ts"

/** A transaction found by its hosted page's access code. */
interface Payable {
  readonly transaction: Transaction
  readonly extra: TransactionExtra
}

function payableOf(context: PaystackRouteContext, code: string): Payable | undefined {
  const { transactions } = context.paystack
  const transaction = transactions
    .all()
    .find((t) => transactions.extra(t.reference)?.accessCode === code)
  const extra = transaction && transactions.extra(transaction.reference)

  return transaction && extra ? { transaction, extra } : undefined
}

/** Where the customer goes after paying: the callback URL with the reference, else the done page. */
function leave(c: Context, payable: Payable, outcome: "paid" | "cancelled"): Response {
  const { callbackUrl } = payable.extra

  if (callbackUrl === null) return c.html(donePage(payable.transaction, outcome))

  const url = new URL(callbackUrl)

  url.searchParams.set("trxref", payable.transaction.reference)
  url.searchParams.set("reference", payable.transaction.reference)

  return c.redirect(url.toString(), 303)
}

/** Whether `expiry` is `MM/YY` (or `MM/YYYY`) for a month that has not passed. */
function validExpiry(expiry: string, now: Date): boolean {
  const match = /^(\d{2})\s*\/\s*(\d{2}|\d{4})$/.exec(expiry)

  if (!match) return false

  const month = Number(match[1])
  const year = Number(match[2]) + ((match[2] ?? "").length === 2 ? 2000 : 0)

  return month >= 1 && month <= 12 && new Date(Date.UTC(year, month, 1)) > now
}

/** Pays with the card the page was given, or asks for its next step. */
function payByCard(
  c: Context,
  context: PaystackRouteContext,
  payments: PaystackPayments,
  payable: Payable,
  number: string,
): Response {
  const card = testCard(number)

  if (card === undefined)
    return c.html(choosePage(payable.transaction, payable.extra, "Invalid card number"), 400)

  if (card.declined !== null) {
    const failed = payments.decline(payable.transaction.reference, card.declined)

    return c.html(choosePage(failed ?? payable.transaction, payable.extra, card.declined), 402)
  }

  if (card.pin !== null) {
    context.paystack.transactions.setExtra(payable.transaction.reference, {
      ...payable.extra,
      pendingCard: card.number,
    })

    return c.html(stepPage(payable.transaction, payable.extra, "pin"))
  }

  return completeCard(c, payments, payable, card.number)
}

function completeCard(
  c: Context,
  payments: PaystackPayments,
  payable: Payable,
  number: string,
): Response {
  const card = testCard(number)
  const paid = payments.succeed(payable.transaction.reference, {
    channel: "card",
    authorization: cardAuthorization({
      number,
      brand: card?.brand ?? "visa",
      expMonth: "12",
      expYear: "2030",
    }),
  })

  return leave(c, { ...payable, transaction: paid ?? payable.transaction }, "paid")
}

/** The card the customer is part-way through paying with. */
function pendingCardOf(payable: Payable) {
  return testCard(payable.extra.pendingCard ?? "")
}

async function cardStep(
  c: Context,
  context: PaystackRouteContext,
  payments: PaystackPayments,
  payable: Payable,
): Promise<Response> {
  const fields = await c.req.parseBody()

  if (!validExpiry(text(fields, "expiry") ?? "", context.clock()))
    return c.html(choosePage(payable.transaction, payable.extra, "Invalid expiry date"), 400)
  if (!/^\d{3,4}$/.test(text(fields, "cvv") ?? ""))
    return c.html(choosePage(payable.transaction, payable.extra, "Invalid CVV"), 400)

  return payByCard(c, context, payments, payable, text(fields, "number") ?? "")
}

async function pinStep(
  c: Context,
  payments: PaystackPayments,
  payable: Payable,
): Promise<Response> {
  const card = pendingCardOf(payable)
  const pin = text(await c.req.parseBody(), "pin")

  if (card === undefined) return c.html(choosePage(payable.transaction, payable.extra), 400)
  if (pin !== card.pin)
    return c.html(stepPage(payable.transaction, payable.extra, "pin", "Incorrect PIN"), 400)
  if (card.otp !== null) return c.html(stepPage(payable.transaction, payable.extra, "otp"))

  return completeCard(c, payments, payable, card.number)
}

async function otpStep(
  c: Context,
  payments: PaystackPayments,
  payable: Payable,
): Promise<Response> {
  const card = pendingCardOf(payable)
  const otp = text(await c.req.parseBody(), "otp")

  if (card === undefined) return c.html(choosePage(payable.transaction, payable.extra), 400)
  if (otp !== card.otp)
    return c.html(stepPage(payable.transaction, payable.extra, "otp", "Invalid OTP"), 400)

  return completeCard(c, payments, payable, card.number)
}

/** The hosted payment page: card (with PIN and OTP steps), bank transfer, USSD, and cancel. */
export function checkoutRoutes(context: PaystackRouteContext, payments: PaystackPayments): void {
  const { app } = context

  const withPayable =
    (handle: (c: Context, payable: Payable) => Response | Promise<Response>) => (c: Context) => {
      const payable = payableOf(context, c.req.param("code"))

      if (payable === undefined)
        return c.html("<h1>This payment link is invalid or has expired</h1>", 404)
      if (payable.transaction.status === "success") return leave(c, payable, "paid")

      return handle(c, payable)
    }

  const byChannel = (channel: string, bank: string) =>
    withPayable((c, payable) => {
      const paid = payments.succeed(payable.transaction.reference, {
        channel,
        authorization: channelAuthorization(channel, bank),
      })

      return leave(c, { ...payable, transaction: paid ?? payable.transaction }, "paid")
    })

  app.get(
    "/:code",
    withPayable((c, payable) => c.html(choosePage(payable.transaction, payable.extra))),
  )
  app.post(
    "/:code/card",
    withPayable((c, payable) => cardStep(c, context, payments, payable)),
  )
  app.post(
    "/:code/pin",
    withPayable((c, payable) => pinStep(c, payments, payable)),
  )
  app.post(
    "/:code/otp",
    withPayable((c, payable) => otpStep(c, payments, payable)),
  )
  app.post("/:code/transfer", byChannel("bank_transfer", "Test Bank"))
  app.post("/:code/ussd", byChannel("ussd", "Guaranty Trust Bank"))
  app.post(
    "/:code/cancel",
    withPayable((c, payable) => leave(c, payable, "cancelled")),
  )
}
