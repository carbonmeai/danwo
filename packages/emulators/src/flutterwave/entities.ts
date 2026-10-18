/**
 * Flutterwave's v3 objects as its API returns them. Ids are numbers, amounts are major units
 * (`7500` naira, not kobo) and times are ISO 8601 with milliseconds.
 */

export type TransactionStatus = "successful" | "failed" | "pending" | "cancelled"

export type PaymentType = "card" | "bank_transfer" | "mobilemoney" | "ussd"

/** The customer as a transaction carries it. */
export interface TransactionCustomer {
  id: number
  name: string
  phone_number: string | null
  email: string
  created_at: string
}

/** The card a transaction was paid with; `token` charges it again for a subscription. */
export interface TransactionCard {
  first_6digits: string
  last_4digits: string
  issuer: string
  country: string
  type: string
  token: string
  expiry: string
}

/** One payment attempt and its outcome, as `GET /v3/transactions/:id/verify` returns it. */
export interface Transaction {
  id: number
  tx_ref: string
  flw_ref: string
  device_fingerprint: string
  amount: number
  currency: string
  charged_amount: number
  app_fee: number
  merchant_fee: number
  processor_response: string
  auth_model: string
  ip: string
  narration: string
  status: TransactionStatus
  payment_type: PaymentType
  created_at: string
  account_id: number
  amount_settled: number
  meta: Record<string, unknown> | null
  card?: TransactionCard
  customer: TransactionCustomer
  plan?: number
}

/** A timeline entry of a transaction (`GET /v3/transactions/:id/events`). */
export interface TransactionEvent {
  type: string
  message: string
  time: string
}

/** What the emulator remembers about a transaction beyond what the API shows. */
export interface TransactionExtra {
  readonly events: readonly TransactionEvent[]
  /** What has been refunded so far, in major units. */
  readonly refunded: number
}

/** A refund of a transaction. */
export interface Refund {
  id: number
  account_id: number
  tx_id: number
  flw_ref: string
  wallet_id: number
  amount_refunded: number
  status: "completed" | "pending"
  destination: string
  meta: { source: string }
  comments: string
  created_at: string
}

/**
 * A payment link from `POST /v3/payments`: what the hosted page charges, and where it sends the
 * customer afterwards.
 */
export interface PaymentLink {
  id: string
  link: string
  tx_ref: string
  amount: number
  currency: string
  redirect_url: string
  customer: { email: string; name: string; phone_number: string | null }
  title: string
  description: string
  meta: Record<string, unknown> | null
  payment_plan: number | null
  payment_options: string
  max_retry_attempt: number | null
  expires_at: string | null
  status: "active" | "disabled" | "used"
}

/** The step of the hosted page a customer is on. */
export type CheckoutStage = "details" | "pin" | "otp" | "address" | "mobile-otp"

/** What a link has seen: failed attempts, the step a customer is on, and what they entered. */
export interface LinkExtra {
  readonly attempts: number
  readonly stage: CheckoutStage
  /** The card being paid with while a PIN, OTP or address is asked for. */
  readonly card: { readonly number: string; readonly expiry: string } | null
  /** The phone a mobile money payment is waiting on an OTP for. */
  readonly phone: string | null
  /** What the page says went wrong with the last step. */
  readonly error: string | null
}

export type PlanInterval =
  | "hourly"
  | "daily"
  | "weekly"
  | "monthly"
  | "quarterly"
  | "bi-annually"
  | "yearly"

export interface PaymentPlan {
  id: number
  name: string
  amount: number
  interval: PlanInterval
  duration: number
  status: "active" | "cancelled"
  currency: string
  plan_token: string
  created_at: string
}

export interface Subscription {
  id: number
  amount: number
  customer: { id: number; customer_email: string }
  plan: number
  status: "active" | "cancelled" | "completed"
  created_at: string
}

/** When a subscription is charged next, how often it has been charged, and with which card. */
export interface SubscriptionExtra {
  readonly nextChargeAt: string
  readonly charges: number
  readonly card: TransactionCard
  readonly customer: TransactionCustomer
}

export type TransferStatus = "NEW" | "PENDING" | "SUCCESSFUL" | "FAILED"

export interface Transfer {
  id: number
  account_number: string
  bank_code: string
  full_name: string
  created_at: string
  currency: string
  debit_currency: string
  amount: number
  fee: number
  status: TransferStatus
  reference: string
  meta: Record<string, unknown> | null
  narration: string
  complete_message: string
  requires_approval: number
  is_approved: number
  bank_name: string
}

/** Where a transfer's status change is also sent, and the retries made of it. */
export interface TransferExtra {
  readonly callbackUrl: string | null
  readonly retries: readonly number[]
}

export interface Beneficiary {
  id: number
  account_number: string
  bank_code: string
  full_name: string
  created_at: string
  bank_name: string
}

export interface VirtualAccount {
  response_code: string
  response_message: string
  flw_ref: string
  order_ref: string
  account_number: string
  frequency: string
  bank_name: string
  created_at: string
  expiry_date: string
  note: string
  amount: string
}

/** The payment a virtual account was opened for, and whether it is a fixed account. */
export interface VirtualAccountExtra {
  readonly txRef: string
  readonly email: string
  readonly name: string
  readonly permanent: boolean
}

/** A bank in `GET /v3/banks/:country`. */
export interface Bank {
  id: number
  code: string
  name: string
}

/** A bank as the emulator keeps it: by country and code. */
export interface SeededBank {
  /** `country:code`, e.g. `NG:044`. */
  id: string
  country: string
  bank: Bank
}

/** An account `POST /v3/accounts/resolve` finds a name for. */
export interface KnownAccount {
  id: string
  bankCode: string
  accountNumber: string
  accountName: string
  blacklisted: boolean
}

/** The merchant's balance in one currency. */
export interface Balance {
  id: string
  currency: string
  available_balance: number
  ledger_balance: number
}
