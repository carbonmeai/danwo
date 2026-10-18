/**
 * Builders for Paystack's objects as the API returns them. Each takes what varies and fills in the
 * fields Paystack always sends, so a route only says what it knows.
 */
import { randomBytes } from "node:crypto"

import type {
  Authorization,
  Bank,
  Customer,
  CustomerSummary,
  DedicatedAccount,
  Integration,
  Interval,
  Plan,
  Recipient,
  Refund,
  Subscription,
  Transaction,
  Transfer,
} from "./entities.ts"
import { paystackCode } from "./helpers.ts"

const DOMAIN = "test"

/** The customer fields a transaction or subscription embeds. */
function summaryOf(customer: Customer): CustomerSummary {
  return {
    id: customer.id,
    first_name: customer.first_name,
    last_name: customer.last_name,
    email: customer.email,
    customer_code: customer.customer_code,
    phone: customer.phone,
    metadata: customer.metadata,
    risk_action: customer.risk_action,
    international_format_phone: customer.international_format_phone,
  }
}

export interface CustomerInput {
  readonly id: number
  readonly email: string
  readonly firstName?: string | undefined
  readonly lastName?: string | undefined
  readonly phone?: string | undefined
  readonly metadata?: Record<string, unknown> | undefined
  readonly integration: Integration
  readonly now: Date
}

export function customerObject(input: CustomerInput): Customer {
  const at = input.now.toISOString()

  return {
    id: input.id,
    first_name: input.firstName ?? null,
    last_name: input.lastName ?? null,
    email: input.email.toLowerCase(),
    customer_code: paystackCode("CUS"),
    phone: input.phone ?? null,
    metadata: input.metadata ?? null,
    risk_action: "default",
    international_format_phone: null,
    integration: input.integration.number,
    domain: DOMAIN,
    identified: false,
    createdAt: at,
    updatedAt: at,
  }
}

export interface TransactionInput {
  readonly id: number
  readonly reference: string
  readonly amount: number
  readonly currency: string
  readonly customer: Customer
  readonly metadata: Record<string, unknown>
  readonly plan: string | null
  readonly now: Date
}

/** A transaction just initialized: nobody has paid yet, which `verify` reports as abandoned. */
export function transactionObject(input: TransactionInput): Transaction {
  const at = input.now.toISOString()

  return {
    id: input.id,
    domain: DOMAIN,
    status: "abandoned",
    reference: input.reference,
    amount: input.amount,
    requested_amount: input.amount,
    message: null,
    gateway_response: "The transaction was not completed",
    paid_at: null,
    paidAt: null,
    created_at: at,
    createdAt: at,
    transaction_date: at,
    channel: "card",
    currency: input.currency,
    ip_address: null,
    metadata: input.metadata,
    fees: null,
    authorization: {},
    customer: summaryOf(input.customer),
    plan: input.plan,
    log: null,
  }
}

/** Paystack's fee in test mode: 1.5% plus ₦100 above ₦2,500, capped at ₦2,000, as on local cards. */
export function feeFor(amount: number): number {
  const fee = Math.round(amount * 0.015) + (amount >= 250_000 ? 10_000 : 0)

  return Math.min(fee, 200_000)
}

export interface CardInput {
  readonly number: string
  readonly brand: string
  readonly expMonth: string
  readonly expYear: string
}

/** A reusable authorization for a card paid with on the hosted page. */
export function cardAuthorization(card: CardInput): Authorization {
  return {
    authorization_code: paystackCode("AUTH", 10),
    bin: card.number.slice(0, 6),
    last4: card.number.slice(-4),
    exp_month: card.expMonth,
    exp_year: card.expYear,
    channel: "card",
    card_type: `${card.brand} `,
    bank: "TEST BANK",
    country_code: "NG",
    brand: card.brand,
    reusable: true,
    signature: `SIG_${randomBytes(10).toString("hex")}`,
    account_name: null,
  }
}

/** The authorization a bank transfer or USSD payment leaves: it cannot be charged again. */
export function channelAuthorization(channel: string, bank: string): Authorization {
  return {
    authorization_code: paystackCode("AUTH", 10),
    bin: "XXXXXX",
    last4: "XXXX",
    exp_month: "12",
    exp_year: "9999",
    channel,
    card_type: "",
    bank,
    country_code: "NG",
    brand: channel,
    reusable: false,
    signature: "",
    account_name: null,
  }
}

export interface PlanInput {
  readonly id: number
  readonly name: string
  readonly amount: number
  readonly interval: Interval
  readonly currency: string
  readonly description: string | null
  readonly invoiceLimit: number
  /** A fixed code, so a seeded plan keeps its code across resets. */
  readonly code?: string | undefined
  readonly integration: Integration
  readonly now: Date
}

export function planObject(input: PlanInput): Plan {
  const at = input.now.toISOString()

  return {
    id: input.id,
    name: input.name,
    plan_code: input.code ?? paystackCode("PLN"),
    description: input.description,
    amount: input.amount,
    interval: input.interval,
    currency: input.currency,
    invoice_limit: input.invoiceLimit,
    send_invoices: true,
    send_sms: true,
    hosted_page: false,
    integration: input.integration.number,
    domain: DOMAIN,
    is_deleted: false,
    createdAt: at,
    updatedAt: at,
  }
}

export interface SubscriptionInput {
  readonly id: number
  readonly customer: Customer
  readonly plan: Plan
  readonly authorization: Authorization
  readonly start: Date
  readonly nextPayment: Date
  readonly emailToken: string
}

/** A cron expression for a plan's interval, in the form Paystack reports. */
const CRON: Readonly<Record<Interval, string>> = {
  hourly: "0 * * * *",
  daily: "0 0 * * *",
  weekly: "0 0 * * 0",
  monthly: "0 0 1 * *",
  quarterly: "0 0 1 */3 *",
  biannually: "0 0 1 */6 *",
  annually: "0 0 1 1 *",
}

export function subscriptionObject(input: SubscriptionInput): Subscription {
  const { plan } = input

  return {
    id: input.id,
    domain: DOMAIN,
    status: "active",
    subscription_code: paystackCode("SUB"),
    email_token: input.emailToken,
    amount: plan.amount,
    quantity: 1,
    start: Math.floor(input.start.getTime() / 1000),
    next_payment_date: input.nextPayment.toISOString(),
    cron_expression: CRON[plan.interval],
    invoice_limit: plan.invoice_limit,
    payments_count: 0,
    integration: plan.integration,
    customer: summaryOf(input.customer),
    plan: {
      id: plan.id,
      name: plan.name,
      plan_code: plan.plan_code,
      amount: plan.amount,
      interval: plan.interval,
      currency: plan.currency,
    },
    authorization: input.authorization,
    createdAt: input.start.toISOString(),
  }
}

export interface RecipientInput {
  readonly id: number
  readonly type: string
  readonly name: string
  readonly currency: string
  readonly accountNumber: string
  readonly accountName: string
  readonly bank: Bank
  readonly integration: Integration
  readonly now: Date
}

export function recipientObject(input: RecipientInput): Recipient {
  const at = input.now.toISOString()

  return {
    id: input.id,
    type: input.type,
    name: input.name,
    recipient_code: paystackCode("RCP"),
    currency: input.currency,
    active: true,
    is_deleted: false,
    integration: input.integration.number,
    domain: DOMAIN,
    details: {
      account_number: input.accountNumber,
      account_name: input.accountName,
      bank_code: input.bank.code,
      bank_name: input.bank.name,
    },
    createdAt: at,
    updatedAt: at,
  }
}

export interface TransferInput {
  readonly id: number
  readonly amount: number
  readonly currency: string
  readonly reason: string | null
  readonly reference: string
  readonly recipient: Recipient
  readonly status: Transfer["status"]
  readonly integration: Integration
  readonly now: Date
}

export function transferObject(input: TransferInput): Transfer {
  const at = input.now.toISOString()

  return {
    id: input.id,
    integration: input.integration.number,
    domain: DOMAIN,
    amount: input.amount,
    currency: input.currency,
    source: "balance",
    reason: input.reason,
    reference: input.reference,
    transfer_code: paystackCode("TRF"),
    status: input.status,
    failures: null,
    recipient: input.recipient,
    transferred_at: null,
    createdAt: at,
    updatedAt: at,
  }
}

export interface RefundInput {
  readonly id: number
  readonly transaction: Transaction
  readonly amount: number
  readonly customerNote: string | null
  readonly merchantNote: string | null
  readonly integration: Integration
  readonly now: Date
}

export function refundObject(input: RefundInput): Refund {
  return {
    id: input.id,
    integration: input.integration.number,
    domain: DOMAIN,
    transaction: input.transaction.id,
    amount: input.amount,
    currency: input.transaction.currency,
    status: "pending",
    refunded_by: "api",
    customer_note: input.customerNote,
    merchant_note: input.merchantNote,
    refunded_at: null,
    createdAt: input.now.toISOString(),
  }
}

export interface DedicatedInput {
  readonly id: number
  readonly accountNumber: string
  readonly bank: Bank
  readonly customer: Customer
  readonly now: Date
}

export function dedicatedObject(input: DedicatedInput): DedicatedAccount {
  const at = input.now.toISOString()
  const names = [input.customer.first_name, input.customer.last_name].filter(Boolean).join(" ")

  return {
    id: input.id,
    account_name: `PAYSTACK/${(names || input.customer.email).toUpperCase()}`,
    account_number: input.accountNumber,
    assigned: true,
    currency: "NGN",
    active: true,
    bank: { id: input.bank.id, name: input.bank.name, slug: input.bank.slug },
    customer: summaryOf(input.customer),
    createdAt: at,
    updatedAt: at,
  }
}
