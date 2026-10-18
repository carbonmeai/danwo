/** How a payment reads in `collection.*` events: amounts, fees, the buyer and how they paid. */
import type { BachsContext } from "./context.ts"
import type { DepositDetails, Payment } from "./entities.ts"
import { money } from "./helpers.ts"

/** A payment as `collection.*` events carry it. */
export function collectionData(context: BachsContext, payment: Payment): Record<string, unknown> {
  const checkout = payment.checkoutId ? context.bachs.checkouts.get(payment.checkoutId) : undefined

  return {
    charge_id: payment.id,
    checkout_id: payment.checkoutId,
    subscription_id: payment.subscriptionId,
    reference: payment.reference,
    status: payment.status === "succeeded" ? "SUCCEEDED" : payment.status.toUpperCase(),
    amount: money(payment.amount),
    currency: payment.currency,
    settlement_amount: money(payment.amount - depositFee(payment)),
    settlement_currency: payment.currency,
    processing_fee: money(depositFee(payment)),
    processing_fee_currency: payment.currency,
    fee_bearer: "merchant",
    product_cart:
      checkout?.lines
        .filter((line) => line.productId)
        .map((line) => ({ product_id: line.productId, quantity: line.quantity })) ?? null,
    customer: { id: payment.customerId, email: payment.customerEmail, name: payment.customerName },
    payment_method_details: methodDetails(payment),
    metadata: payment.metadata ?? {},
  }
}

function methodDetails(payment: Payment): Record<string, unknown> {
  if (!payment.deposit)
    return { type: "card", card: { last4: payment.cardLast4, currency: payment.currency } }

  return { type: "bank_transfer", bank_transfer: depositTransfer(payment.deposit) }
}

function depositTransfer(deposit: DepositDetails) {
  return {
    sender_name: deposit.senderName,
    sender_bank: deposit.senderBank,
    sender_bank_code: deposit.senderBankCode,
    sender_account_number: deposit.senderAccountNumber,
    session_id: deposit.sessionId,
    narration: deposit.narration,
    virtual_account: { id: deposit.virtualAccountId, type: "permanent", expires_at: null },
  }
}

/** A deposit's fee: 1% of the amount, at most NGN 300. Card payments carry no fee here. */
export function depositFee(payment: Payment): number {
  return payment.deposit ? Math.min(Math.round(payment.amount / 100), 30_000) : 0
}
