/**
 * Flutterwave objects built from what the emulator knows, and the payloads of its webhooks. Each
 * object keeps the field set the v3 API documents for it.
 */
import type {
  PaymentType,
  Transaction,
  TransactionCard,
  TransactionCustomer,
  TransactionStatus,
  Transfer,
} from "./entities.ts"
import { ACCOUNT_ID, appFee, hex, isoTime, money } from "./helpers.ts"

/** What a payment attempt is made of before it becomes a transaction. */
export interface Attempt {
  readonly id: number
  readonly txRef: string
  readonly amount: number
  readonly currency: string
  readonly status: TransactionStatus
  readonly processorResponse: string
  readonly paymentType: PaymentType
  readonly authModel: string
  readonly customer: TransactionCustomer
  readonly card?: TransactionCard
  readonly meta: Record<string, unknown> | null
  readonly plan?: number | null
  readonly now: Date
}

/** How Flutterwave describes a payment of `type` in a transaction's narration. */
function narrationOf(type: PaymentType): string {
  const names: Record<PaymentType, string> = {
    card: "CARD Transaction ",
    bank_transfer: "Bank Transfer",
    mobilemoney: "Mobile Money",
    ussd: "USSD Transaction",
  }

  return names[type]
}

/** A transaction as `verify` and list endpoints return it. */
export function transactionObject(attempt: Attempt): Transaction {
  const fee = attempt.status === "successful" ? appFee(attempt.amount) : 0

  return {
    id: attempt.id,
    tx_ref: attempt.txRef,
    flw_ref: `FLW-MOCK-${hex(16)}`,
    device_fingerprint: "N/A",
    amount: attempt.amount,
    currency: attempt.currency,
    charged_amount: attempt.amount,
    app_fee: fee,
    merchant_fee: 0,
    processor_response: attempt.processorResponse,
    auth_model: attempt.authModel,
    ip: "127.0.0.1",
    narration: narrationOf(attempt.paymentType),
    status: attempt.status,
    payment_type: attempt.paymentType,
    created_at: isoTime(attempt.now),
    account_id: ACCOUNT_ID,
    amount_settled: money(attempt.amount - fee),
    meta: attempt.meta,
    ...(attempt.card && { card: attempt.card }),
    customer: attempt.customer,
    ...(attempt.plan != null && { plan: attempt.plan }),
  }
}

/** The card as a webhook shows it: without the token a merchant charges again. */
function webhookCard(card: TransactionCard) {
  return {
    first_6digits: card.first_6digits,
    last_4digits: card.last_4digits,
    issuer: card.issuer,
    country: card.country,
    type: card.type,
    expiry: card.expiry,
  }
}

/** How a `charge.completed` webhook names the payment method. */
function eventType(type: PaymentType): string {
  const names: Record<PaymentType, string> = {
    card: "CARD_TRANSACTION",
    bank_transfer: "BANK_TRANSFER_TRANSACTION",
    mobilemoney: "MOBILEMONEY_TRANSACTION",
    ussd: "USSD_TRANSACTION",
  }

  return names[type]
}

/** The body of a `charge.completed` webhook. */
export function chargeCompleted(transaction: Transaction) {
  return {
    event: "charge.completed",
    data: {
      id: transaction.id,
      tx_ref: transaction.tx_ref,
      flw_ref: transaction.flw_ref,
      device_fingerprint: transaction.device_fingerprint,
      amount: transaction.amount,
      currency: transaction.currency,
      charged_amount: transaction.charged_amount,
      app_fee: transaction.app_fee,
      merchant_fee: transaction.merchant_fee,
      processor_response: transaction.processor_response,
      auth_model: transaction.auth_model,
      ip: transaction.ip,
      narration: transaction.narration,
      status: transaction.status,
      payment_type: transaction.payment_type,
      created_at: transaction.created_at,
      account_id: transaction.account_id,
      customer: transaction.customer,
      ...(transaction.card && { card: webhookCard(transaction.card) }),
    },
    "event.type": eventType(transaction.payment_type),
  }
}

/** The body of a `transfer.completed` webhook. */
export function transferCompleted(transfer: Transfer) {
  return {
    event: "transfer.completed",
    "event.type": "Transfer",
    data: {
      id: transfer.id,
      account_number: transfer.account_number,
      bank_name: transfer.bank_name,
      bank_code: transfer.bank_code,
      fullname: transfer.full_name,
      created_at: transfer.created_at,
      currency: transfer.currency,
      debit_currency: transfer.debit_currency,
      amount: transfer.amount,
      fee: transfer.fee,
      status: transfer.status,
      reference: transfer.reference,
      meta: transfer.meta,
      narration: transfer.narration,
      approver: null,
      complete_message: transfer.complete_message,
      requires_approval: transfer.requires_approval,
      is_approved: transfer.is_approved,
    },
  }
}
