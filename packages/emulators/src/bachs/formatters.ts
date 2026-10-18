import type {
  BalancesResponse,
  CheckoutSessionCreated,
  CheckoutSessionResponse,
  PaymentListItem,
  PaymentResponse,
  PayoutDestinationResponse,
  PayoutQuoteResponse,
  PayoutResponse,
  ProductResponse,
  SubscriptionResponse,
} from "@bachs/sdk"

import type {
  CheckoutSession,
  Customer,
  Invoice,
  Payment,
  Payout,
  PayoutDestination,
  PayoutQuote,
  Price,
  Product,
  Refund,
  Subscription,
  VirtualAccount,
  WebhookEndpointRecord,
} from "./entities.ts"
import { CHECKOUT_ORIGIN, money } from "./helpers.ts"
import type { BachsStore } from "./store.ts"

/** Minor units as a money string, or null. */
function moneyOrNull(minor: number | null): string | null {
  return minor === null ? null : money(minor)
}

function priceObject(price: Price) {
  return {
    currency: price.currency,
    price_type: price.type,
    amount: money(price.amount ?? 0),
    preset_amount: moneyOrNull(price.preset),
    minimum_amount: moneyOrNull(price.minimum),
    maximum_amount: moneyOrNull(price.maximum),
    currency_options: [],
  }
}

export function productObject(product: Product, organization: string) {
  return {
    id: product.id,
    organization_id: organization,
    name: product.name,
    description: product.description,
    status: product.archivedAt ? "archived" : "active",
    price: priceObject(product.price),
    billing_cycle: product.billingCycle,
    trial_period: product.trialPeriod,
    metadata: product.metadata,
    media: [],
    created_at: product.createdAt,
    updated_at: product.updatedAt,
    archived_at: product.archivedAt,
  } satisfies ProductResponse
}

export function customerObject(customer: Customer) {
  return {
    customer_id: customer.id,
    email: customer.email,
    name: customer.name,
    phone_number: customer.phoneNumber,
    metadata: customer.metadata,
    billing_address: customer.billingAddress,
    created_at: customer.createdAt,
    updated_at: customer.updatedAt,
  }
}

/** A checkout's hosted page URL. */
function checkoutUrl(checkout: CheckoutSession): string {
  return `${CHECKOUT_ORIGIN}/c/${checkout.token}`
}

/** What creating a checkout answers. */
export function createdCheckoutObject(checkout: CheckoutSession) {
  return {
    checkout_id: checkout.id,
    checkout_url: checkoutUrl(checkout),
    status: checkout.status,
    expires_at: checkout.expiresAt,
    created_at: checkout.createdAt,
    reference: checkout.reference,
  } satisfies CheckoutSessionCreated
}

/** The total a checkout charges, in minor units: the buyer's chosen amount for custom pricing. */
export function checkoutTotal(checkout: CheckoutSession): number {
  if (checkout.chosenAmount !== null) return checkout.chosenAmount

  return checkout.lines.reduce(
    (sum, line) => sum + (line.price.amount ?? line.price.preset ?? 0) * line.quantity,
    0,
  )
}

function identityOf(customer: Customer | undefined) {
  return customer ? { id: customer.id, email: customer.email, name: customer.name } : null
}

export function checkoutObject(checkout: CheckoutSession, bachs: BachsStore) {
  const payment = checkout.paymentId ? bachs.payments.get(checkout.paymentId) : undefined
  const customer = checkout.customerId ? bachs.customers.get(checkout.customerId) : undefined

  return {
    checkout_id: checkout.id,
    checkout_url: checkoutUrl(checkout),
    status: checkout.status,
    amount: money(checkoutTotal(checkout)),
    currency: checkout.currency,
    payment_status: paymentStatusOf(checkout, payment),
    source_type: checkout.lines.some((line) => line.productId) ? "product_cart" : "pricing",
    reference: checkout.reference,
    charge: payment ? paymentObject(payment) : null,
    payment_method: payment?.method ?? null,
    customer: identityOf(customer),
    customer_details: checkout.customerDetails,
    success_url: checkout.successUrl,
    cancel_url: checkout.cancelUrl,
    billing_currency: checkout.currency,
    session_mode: checkout.mode,
    subscription_id: checkout.subscriptionId,
    metadata: checkout.metadata,
    created_at: checkout.createdAt,
    expires_at: checkout.expiresAt,
    completed_at: checkout.completedAt,
    updated_at: checkout.updatedAt,
  } satisfies CheckoutSessionResponse
}

/** Whether a checkout's money came in: `paid`, `unpaid`, or `no_payment_required` for a free one. */
export function paymentStatusOf(checkout: CheckoutSession, payment: Payment | undefined): string {
  if (checkout.status === "completed" && !payment) return "no_payment_required"

  return payment && payment.status !== "open" && payment.status !== "failed" ? "paid" : "unpaid"
}

/** Whether a payment can still take a refund. */
export function isRefundable(payment: Payment, bachs: BachsStore): boolean {
  const live = bachs.refunds.where(
    (refund) => refund.chargeId === payment.id && refund.status !== "failed",
  )

  return (
    payment.status === "succeeded" && payment.method !== "NGN_BANK_TRANSFER" && live.length === 0
  )
}

export function paymentObject(payment: Payment, bachs?: BachsStore) {
  return {
    payment_id: payment.id,
    status: payment.status,
    substatus: payment.substatus,
    amount: money(payment.amount),
    currency: payment.currency,
    created_at: payment.createdAt,
    updated_at: payment.updatedAt,
    reference: payment.reference,
    checkout_id: payment.checkoutId,
    subscription_id: payment.subscriptionId,
    billing_reason: payment.billingReason,
    fee_usd: "0.00",
    amount_paid:
      payment.status === "open" || payment.status === "failed" ? "0.00" : money(payment.amount),
    amount_remaining: payment.status === "open" ? money(payment.amount) : "0.00",
    refunded_amount: money(payment.refunded),
    payment_method: payment.method,
    completed_at: payment.completedAt,
    is_refundable: bachs ? isRefundable(payment, bachs) : payment.status === "succeeded",
    meta: payment.metadata,
  } satisfies PaymentResponse
}

export function paymentListItem(payment: Payment) {
  return {
    id: payment.id,
    status: payment.status,
    amount: money(payment.amount),
    currency: payment.currency,
    customer_name: payment.customerName ?? "",
    customer_email: payment.customerEmail ?? "",
    reference: payment.reference,
    amount_paid: payment.status === "succeeded" ? money(payment.amount) : "0.00",
    amount_remaining: "0.00",
    settlement_amount: money(payment.amount),
    settlement_currency: payment.currency,
    fee: "0.00",
    vat: "0.00",
    transaction_date: payment.createdAt,
    completed_at: payment.completedAt,
  } satisfies PaymentListItem
}

export function subscriptionObject(subscription: Subscription, bachs: BachsStore) {
  const customer = bachs.customers.get(subscription.customerId)
  const product = bachs.products.get(subscription.productId)
  const amount = money(subscription.unitAmount * subscription.seats)

  return {
    id: subscription.id,
    subscription_id: subscription.id,
    status: subscription.status,
    customer: {
      customer_id: subscription.customerId,
      email: customer?.email ?? null,
      name: customer?.name ?? null,
      phone_number: customer?.phoneNumber ?? null,
    },
    product_id: subscription.productId,
    product: {
      id: subscription.productId,
      name: product?.name ?? "",
      billing_cycle: subscription.billingCycle,
    },
    payment_method_id: subscription.paymentMethodId,
    collection_method: "charge_automatically",
    currency: subscription.currency,
    amount,
    billing_cycle: subscription.billingCycle,
    quantity: subscription.seats,
    seats: subscription.seats,
    current_period_start: subscription.periodStart,
    current_period_end: subscription.periodEnd,
    previously_billed_at: subscription.previouslyBilledAt,
    next_billed_at: subscription.nextBilledAt,
    trial_end: subscription.trialEnd,
    cancel_at_period_end: subscription.cancelAtPeriodEnd,
    canceled_at: subscription.canceledAt,
    cancellation_reason: subscription.cancelReason,
    created_at: subscription.createdAt,
    items: [
      {
        id: subscription.itemId,
        status: subscription.status === "canceled" ? "canceled" : "active",
        quantity: subscription.seats,
        seats: subscription.seats,
        recurring: true,
        price_type: subscription.priceType,
        unit_amount: money(subscription.unitAmount),
        currency: subscription.currency,
        previously_billed_at: subscription.previouslyBilledAt,
        next_billed_at: subscription.nextBilledAt,
      },
    ],
    metadata: subscription.metadata,
  } satisfies SubscriptionResponse
}

export function invoiceObject(invoice: Invoice, bachs: BachsStore) {
  const customer = bachs.customers.get(invoice.customerId)

  return {
    invoice_id: invoice.id,
    subscription: { subscription_id: invoice.subscriptionId },
    customer: {
      customer_id: invoice.customerId,
      email: customer?.email ?? null,
      name: customer?.name ?? null,
    },
    charge: invoice.chargeId,
    status: invoice.status,
    billing_reason: invoice.billingReason,
    collection_method: "charge_automatically",
    currency: invoice.currency,
    subtotal: money(invoice.subtotal),
    credit_applied: money(invoice.creditApplied),
    total: money(invoice.total),
    amount_paid: money(invoice.amountPaid),
    amount_remaining: money(invoice.total - invoice.amountPaid),
    period_start: invoice.periodStart,
    period_end: invoice.periodEnd,
    attempt_count: invoice.attemptCount,
    next_payment_attempt: invoice.nextPaymentAttempt,
    created_at: invoice.createdAt,
    metadata: {},
  }
}

export function refundObject(refund: Refund, refundedNow: boolean) {
  return {
    refund_id: refund.id,
    charge_id: refund.chargeId,
    reference: refund.reference,
    status: refund.status,
    requested_amount: money(refund.requested),
    refunded_amount: refundedNow ? money(refund.requested) : null,
    refund_fee_amount: "0.00",
    fee_bearer: refund.feeBearer,
    reason: refund.reason,
    created_at: refund.createdAt,
    updated_at: refund.updatedAt,
    completed_at: refund.completedAt,
  }
}

export function destinationObject(destination: PayoutDestination) {
  return {
    id: destination.id,
    name: destination.name,
    type: destination.type,
    currency: destination.currency,
    status: destination.status,
    is_usable: destination.status === "approved",
    is_default: false,
    status_reason:
      destination.status === "rejected" ? "Account details could not be verified" : null,
    account_number: destination.accountNumber,
    account_name: destination.accountName,
    bank_code: destination.bankCode,
    bank_name: destination.bankName,
    phone_number: destination.phoneNumber,
    mobile_provider: destination.mobileProvider,
    wallet_address: destination.walletAddress,
    network: destination.network,
    reviewed_at: destination.status === "pending_review" ? null : destination.createdAt,
    created_at: destination.createdAt,
    updated_at: destination.updatedAt,
  } satisfies PayoutDestinationResponse
}

export function quoteObject(quote: PayoutQuote) {
  return {
    quote_id: quote.id,
    from_currency: quote.fromCurrency,
    to_currency: quote.toCurrency,
    from_amount: money(quote.fromAmount),
    to_amount: money(quote.toAmount),
    exchange_rate: quote.rate,
    expires_at: quote.expiresAt,
  } satisfies PayoutQuoteResponse
}

export function payoutObject(payout: Payout) {
  return {
    id: payout.id,
    status: payout.status,
    amount: money(payout.amount),
    currency: payout.currency,
    source_currency: payout.sourceCurrency,
    fee: money(payout.fee),
    total_debited: money(payout.sourceAmount + payout.fee),
    destination: payout.destinationId,
    reference: payout.reference,
    failure_reason: payout.failureReason,
    created_at: payout.createdAt,
    completed_at: payout.completedAt,
  } satisfies PayoutResponse
}

/** A payout as its `payout.*` events carry it. */
export function payoutEventData(payout: Payout) {
  return {
    withdrawal_id: payout.id,
    reference: payout.reference,
    status: payout.status,
    amount: money(payout.sourceAmount),
    currency: payout.sourceCurrency,
    from_currency: payout.sourceCurrency,
    to_currency: payout.currency,
    exchange_rate: payout.rate ?? "1.00",
    to_amount: money(payout.amount),
    withdrawal_fee: money(payout.fee),
    net_from_amount: money(payout.sourceAmount),
    failure_reason: payout.failureReason,
  }
}

export function balancesObject(bachs: BachsStore, usdPerUnit: (currency: string) => number) {
  const rows = bachs.balances.all()
  const totalUsd = rows.reduce(
    (sum, row) => sum + Math.round(row.available * usdPerUnit(row.currency)),
    0,
  )

  return {
    account_id: bachs.organization(),
    balances: rows.map((row) => ({
      currency: row.currency,
      available_balance: money(row.available),
      pending_balance: money(row.pending),
      held_for_disputes: "0.00",
    })),
    total_balance_usd: money(totalUsd),
    pending_settlements_by_day: [],
  } satisfies BalancesResponse
}

export function virtualAccountObject(account: VirtualAccount) {
  return {
    id: account.id,
    currency: account.currency,
    account_number: account.accountNumber,
    bank_name: account.bankName,
    bank_code: account.bankCode,
    status: "active",
    created_at: account.createdAt,
  }
}

export function endpointObject(endpoint: WebhookEndpointRecord) {
  return {
    endpoint_id: endpoint.id,
    name: endpoint.name,
    url: endpoint.url,
    enabled: endpoint.enabled,
    disabled_at: null,
    disabled_reason: null,
    event_types: endpoint.eventTypes,
    event_source: "account",
    created_at: endpoint.createdAt,
    updated_at: endpoint.updatedAt,
  }
}
