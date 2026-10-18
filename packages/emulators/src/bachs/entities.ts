/**
 * What the Bachs emulator keeps. Money is held in minor units (hundredths) and written out as
 * decimal strings by the formatters; times are kept as ISO strings, as the API returns them.
 */

export type PriceType = "fixed" | "free" | "custom"

export type Interval = "day" | "week" | "month" | "year"

/** A recurring cadence or a trial's length: `frequency` intervals. */
export interface Cadence {
  readonly interval: Interval
  readonly frequency: number
}

/** A product's price in its primary currency. Amounts in minor units. */
export interface Price {
  readonly currency: string
  readonly type: PriceType
  readonly amount: number | null
  readonly preset: number | null
  readonly minimum: number | null
  readonly maximum: number | null
}

export interface Product {
  readonly id: string
  readonly name: string
  readonly description: string | null
  readonly price: Price
  readonly billingCycle: Cadence | null
  readonly trialPeriod: Cadence | null
  readonly metadata: Record<string, unknown> | null
  readonly archivedAt: string | null
  readonly createdAt: string
  readonly updatedAt: string
}

export interface BillingAddress {
  readonly line1: string
  readonly line2: string | null
  readonly city: string | null
  readonly state: string | null
  readonly postal_code: string | null
  readonly country: string
}

export interface Customer {
  readonly id: string
  readonly email: string
  readonly name: string | null
  readonly phoneNumber: string | null
  readonly metadata: Record<string, unknown>
  readonly billingAddress: BillingAddress | null
  /** Credit from downgrades, by currency, drawn down on later invoices. */
  readonly credit: Readonly<Record<string, number>>
  readonly createdAt: string
  readonly updatedAt: string
}

/** One line of a checkout: a catalog product or a raw amount, priced for this checkout. */
export interface CheckoutLine {
  readonly productId: string | null
  readonly name: string
  readonly quantity: number
  readonly price: Price
  readonly recurring: boolean
}

export type CheckoutStatus = "open" | "completed" | "expired"

export interface CheckoutSession {
  readonly id: string
  /** The secret part of `checkout_url`. */
  readonly token: string
  readonly status: CheckoutStatus
  readonly mode: "payment" | "subscription"
  readonly currency: string
  readonly lines: readonly CheckoutLine[]
  readonly customerId: string | null
  readonly customerDetails: { readonly email: string; readonly name: string | null } | null
  readonly customerCreation: "always" | "if_required"
  readonly reference: string | null
  readonly metadata: Record<string, unknown> | null
  readonly successUrl: string | null
  readonly cancelUrl: string | null
  readonly paymentId: string | null
  readonly subscriptionId: string | null
  /** The amount the buyer chose, for a custom-priced checkout. */
  readonly chosenAmount: number | null
  readonly createdAt: string
  readonly expiresAt: string
  readonly completedAt: string | null
  readonly updatedAt: string
}

export type PaymentStatus =
  | "open"
  | "processing"
  | "succeeded"
  | "failed"
  | "refunded"
  | "partially_refunded"

/** A charge: money a customer paid, through a checkout, a subscription invoice or a deposit. */
export interface Payment {
  readonly id: string
  readonly status: PaymentStatus
  readonly substatus: string | null
  readonly amount: number
  readonly currency: string
  readonly checkoutId: string | null
  readonly subscriptionId: string | null
  readonly invoiceId: string | null
  readonly customerId: string | null
  readonly customerEmail: string | null
  readonly customerName: string | null
  readonly reference: string | null
  readonly billingReason: string
  readonly method: "USD_CARD" | "NGN_CARD" | "NGN_BANK_TRANSFER"
  readonly cardLast4: string | null
  /** A virtual account deposit's sender and the account it landed in. */
  readonly deposit: DepositDetails | null
  readonly refunded: number
  readonly metadata: Record<string, unknown> | null
  /** When a processing payment settles, on the emulator's clock. */
  readonly settlesAt: string | null
  readonly createdAt: string
  readonly updatedAt: string
  readonly completedAt: string | null
}

export interface DepositDetails {
  readonly senderName: string | null
  readonly senderBank: string | null
  readonly senderBankCode: string | null
  readonly senderAccountNumber: string | null
  readonly narration: string | null
  readonly sessionId: string
  readonly virtualAccountId: string
}

export type RefundStatus = "processing" | "success" | "failed"

export interface Refund {
  readonly id: string
  readonly chargeId: string
  readonly reference: string
  readonly status: RefundStatus
  readonly requested: number
  readonly currency: string
  readonly reason: string | null
  readonly feeBearer: "org" | "customer"
  readonly outcome: "success" | "failed"
  readonly idempotencyKey: string | null
  /** When a processing refund settles, on the emulator's clock. */
  readonly settlesAt: string | null
  readonly createdAt: string
  readonly updatedAt: string
  readonly completedAt: string | null
}

export type SubscriptionStatus = "trialing" | "active" | "past_due" | "unpaid" | "canceled"

export interface Subscription {
  readonly id: string
  readonly itemId: string
  readonly customerId: string
  readonly productId: string
  readonly paymentMethodId: string
  readonly status: SubscriptionStatus
  readonly currency: string
  /** The price of one seat, in minor units. */
  readonly unitAmount: number
  readonly priceType: PriceType
  readonly billingCycle: Cadence
  readonly seats: number
  readonly periodStart: string
  readonly periodEnd: string
  readonly previouslyBilledAt: string | null
  readonly nextBilledAt: string | null
  readonly trialEnd: string | null
  readonly cancelAtPeriodEnd: boolean
  readonly canceledAt: string | null
  readonly cancelReason: string | null
  /** A prorated charge deferred to the next renewal (`next_cycle`), in minor units. */
  readonly pendingProration: number
  readonly metadata: Record<string, unknown>
  readonly createdAt: string
}

export type InvoiceStatus = "open" | "paid" | "void" | "uncollectible"

export interface Invoice {
  readonly id: string
  readonly subscriptionId: string
  readonly customerId: string
  readonly status: InvoiceStatus
  readonly billingReason: string
  readonly currency: string
  readonly subtotal: number
  readonly creditApplied: number
  readonly total: number
  readonly amountPaid: number
  readonly periodStart: string
  readonly periodEnd: string
  readonly attemptCount: number
  readonly nextPaymentAttempt: string | null
  readonly chargeId: string | null
  readonly createdAt: string
}

/** A card the customer saved at checkout. Its number decides how later charges go. */
export interface SavedCard {
  readonly id: string
  readonly customerId: string
  readonly number: string
  readonly last4: string
}

export interface PortalSession {
  readonly id: string
  readonly token: string
  readonly customerId: string
  readonly expiresAt: string
}

/** A recovery email Bachs sent when a renewal charge failed. */
export interface RecoveryEmail {
  readonly id: string
  readonly customerId: string
  readonly subscriptionId: string
  readonly invoiceId: string
  readonly email: string
  /** The secret part of `link`. */
  readonly token: string
  /** The hosted page where the customer enters a new card. */
  readonly link: string
  readonly exhausted: boolean
  readonly sentAt: string
}

export type DestinationStatus = "pending_review" | "approved" | "rejected"

export interface PayoutDestination {
  readonly id: string
  readonly name: string
  readonly type: string
  readonly currency: string
  readonly status: DestinationStatus
  readonly accountNumber: string | null
  readonly accountName: string | null
  readonly bankCode: string | null
  readonly bankName: string | null
  readonly phoneNumber: string | null
  readonly mobileProvider: string | null
  readonly walletAddress: string | null
  readonly network: string | null
  /** Payouts to this destination fail once sent (a seeded failing account). */
  readonly fails: boolean
  readonly createdAt: string
  readonly updatedAt: string
}

export interface PayoutQuote {
  readonly id: string
  readonly fromCurrency: string
  readonly toCurrency: string
  readonly fromAmount: number
  readonly toAmount: number
  readonly rate: string
  readonly expiresAt: string
}

export type PayoutStatus = "processing" | "completed" | "failed"

export interface Payout {
  readonly id: string
  readonly destinationId: string
  readonly status: PayoutStatus
  readonly sourceCurrency: string
  readonly sourceAmount: number
  readonly currency: string
  readonly amount: number
  readonly rate: string | null
  readonly fee: number
  readonly reference: string | null
  readonly failureReason: string | null
  readonly metadata: Record<string, unknown> | null
  /** When a processing payout settles, on the emulator's clock. */
  readonly settlesAt: string | null
  readonly createdAt: string
  readonly completedAt: string | null
}

export interface VirtualAccount {
  readonly id: string
  readonly currency: string
  readonly accountNumber: string
  readonly bankName: string
  readonly bankCode: string
  readonly createdAt: string
}

export interface WebhookEndpointRecord {
  readonly id: string
  readonly name: string | null
  readonly url: string
  readonly enabled: boolean
  readonly eventTypes: readonly string[]
  readonly secret: string
  readonly createdAt: string
  readonly updatedAt: string
}

/** Money held by the account, by currency, in minor units. */
export interface BalanceRow {
  readonly id: string
  readonly currency: string
  readonly available: number
  readonly pending: number
}
