/**
 * Paystack's objects as its API answers them. Amounts are whole numbers in the currency's subunit
 * (kobo, pesewas, cents); dates are ISO 8601 strings.
 */

/** A saved card or account the customer can be charged on again. */
export interface Authorization {
  readonly authorization_code: string
  readonly bin: string
  readonly last4: string
  readonly exp_month: string
  readonly exp_year: string
  readonly channel: string
  readonly card_type: string
  readonly bank: string
  readonly country_code: string
  readonly brand: string
  readonly reusable: boolean
  readonly signature: string
  readonly account_name: string | null
}

/** A customer of the integration. */
export interface Customer {
  readonly id: number
  readonly first_name: string | null
  readonly last_name: string | null
  readonly email: string
  readonly customer_code: string
  readonly phone: string | null
  readonly metadata: Record<string, unknown> | null
  readonly risk_action: string
  readonly international_format_phone: string | null
  readonly integration: number
  readonly domain: string
  readonly identified: boolean
  readonly createdAt: string
  readonly updatedAt: string
}

/** The customer as a transaction or subscription embeds it. */
export type CustomerSummary = Pick<
  Customer,
  | "id"
  | "first_name"
  | "last_name"
  | "email"
  | "customer_code"
  | "phone"
  | "metadata"
  | "risk_action"
  | "international_format_phone"
>

export const TRANSACTION_STATUSES = [
  "abandoned",
  "ongoing",
  "pending",
  "processing",
  "success",
  "failed",
  "reversed",
] as const

export type TransactionStatus = (typeof TRANSACTION_STATUSES)[number]

/** A payment: initialized, then paid (or failed) on the hosted page, by a saved authorization or a transfer. */
export interface Transaction {
  readonly id: number
  readonly domain: string
  readonly status: TransactionStatus
  readonly reference: string
  readonly receipt_number: string | null
  readonly amount: number
  readonly requested_amount: number
  readonly message: string | null
  readonly gateway_response: string
  readonly gateway_response_code: string | null
  readonly response_code: string | null
  readonly paid_at: string | null
  readonly paidAt: string | null
  readonly created_at: string
  readonly createdAt: string
  readonly transaction_date: string
  readonly channel: string
  readonly currency: string
  readonly ip_address: string | null
  /** What the caller attached; an empty string when it attached nothing. */
  readonly metadata: Record<string, unknown> | ""
  readonly fees: number | null
  readonly fees_split: null
  readonly fees_breakdown: null
  readonly authorization: Authorization | Record<string, never>
  readonly customer: CustomerSummary
  readonly plan: string | null
  /** The plan the transaction pays for, or an empty object. */
  readonly plan_object: Plan | Record<string, never>
  readonly split: Record<string, never>
  readonly subaccount: Record<string, never>
  readonly order_id: null
  readonly pos_transaction_data: null
  readonly source: null
  readonly connect: null
  readonly log: null
}

/** What the emulator remembers about a transaction beyond what the API shows. */
export interface TransactionExtra {
  readonly accessCode: string
  readonly callbackUrl: string | null
  readonly channels: readonly string[]
  /** The plan the payment subscribes the customer to, once it succeeds. */
  readonly plan: string | null
  /** The card number entered on the hosted page while it waits for a PIN or an OTP. */
  readonly pendingCard: string | null
}

export const INTERVALS = [
  "hourly",
  "daily",
  "weekly",
  "monthly",
  "quarterly",
  "biannually",
  "annually",
] as const

export type Interval = (typeof INTERVALS)[number]

/** A price charged on a schedule. */
export interface Plan {
  readonly id: number
  readonly name: string
  readonly plan_code: string
  readonly description: string | null
  readonly amount: number
  readonly interval: Interval
  readonly currency: string
  readonly invoice_limit: number
  readonly send_invoices: boolean
  readonly send_sms: boolean
  readonly hosted_page: boolean
  readonly integration: number
  readonly domain: string
  readonly is_deleted: boolean
  readonly createdAt: string
  readonly updatedAt: string
}

export type SubscriptionStatus = "active" | "non-renewing" | "attention" | "completed" | "cancelled"

/** A customer on a plan, charged on its saved authorization every interval. */
export interface Subscription {
  readonly id: number
  readonly domain: string
  readonly status: SubscriptionStatus
  readonly subscription_code: string
  readonly email_token: string
  readonly amount: number
  readonly quantity: number
  readonly start: number
  readonly next_payment_date: string | null
  readonly cron_expression: string
  readonly invoice_limit: number
  readonly payments_count: number
  readonly integration: number
  readonly customer: CustomerSummary
  readonly plan: Pick<Plan, "id" | "name" | "plan_code" | "amount" | "interval" | "currency">
  readonly authorization: Authorization
  readonly createdAt: string
}

/** Where a transfer goes: a bank account (or mobile money wallet) with its resolved name. */
export interface Recipient {
  readonly id: number
  readonly type: string
  readonly name: string
  readonly recipient_code: string
  readonly currency: string
  readonly active: boolean
  readonly is_deleted: boolean
  readonly integration: number
  readonly domain: string
  readonly details: {
    readonly account_number: string
    readonly account_name: string
    readonly bank_code: string
    readonly bank_name: string
  }
  readonly createdAt: string
  readonly updatedAt: string
}

export type TransferStatus = "otp" | "pending" | "success" | "failed" | "reversed" | "abandoned"

/** Money sent from the integration's balance to a recipient. */
export interface Transfer {
  readonly id: number
  readonly integration: number
  readonly domain: string
  readonly amount: number
  readonly currency: string
  readonly source: string
  readonly reason: string | null
  readonly reference: string
  readonly transfer_code: string
  readonly status: TransferStatus
  readonly failures: null
  readonly recipient: Recipient
  readonly transferred_at: string | null
  readonly createdAt: string
  readonly updatedAt: string
}

export type RefundStatus = "pending" | "processing" | "processed" | "failed"

/** Money given back on a successful transaction. */
export interface Refund {
  readonly id: number
  readonly integration: number
  readonly domain: string
  readonly transaction: number
  readonly amount: number
  readonly currency: string
  readonly status: RefundStatus
  readonly refunded_by: string
  readonly customer_note: string | null
  readonly merchant_note: string | null
  readonly refunded_at: string | null
  readonly createdAt: string
}

/** A bank Paystack lists, with the code transfers and resolution use. */
export interface Bank {
  readonly id: number
  readonly name: string
  readonly slug: string
  readonly code: string
  readonly country: string
  readonly currency: string
  readonly type: string
  readonly active: boolean
}

/** A bank account number reserved for one customer; money sent to it pays the integration. */
export interface DedicatedAccount {
  readonly id: number
  readonly account_name: string
  readonly account_number: string
  readonly assigned: boolean
  readonly currency: string
  readonly active: boolean
  readonly bank: { readonly id: number; readonly name: string; readonly slug: string }
  readonly customer: CustomerSummary
  readonly createdAt: string
  readonly updatedAt: string
}

/** A Paystack business: its keys, where its webhooks go, and its balance for transfers. */
export interface Integration {
  /** The secret key, which is also the key webhooks are signed with. */
  readonly id: string
  readonly number: number
  readonly publicKey: string
  readonly webhookUrl: string | null
  readonly callbackUrl: string | null
  readonly currency: string
  /** Asking for an OTP before each transfer, as live integrations may. */
  readonly transferOtp: boolean
}

/** What the emulator keeps about an integration that changes as it runs. */
export interface IntegrationExtra {
  /** Available balance per currency, in subunits. */
  readonly balance: Readonly<Record<string, number>>
}

/** A bank account the "resolve account number" endpoint knows, and whether transfers to it fail. */
export interface KnownAccount {
  /** `bank code:account number`. */
  readonly id: string
  readonly accountName: string
  /** What happens to a transfer to it: success by default. */
  readonly transferOutcome: "success" | "failed" | "reversed"
}
