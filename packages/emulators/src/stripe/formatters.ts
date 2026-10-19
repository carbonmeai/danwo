/**
 * Builders for complete Stripe objects. Each is typed against the `stripe` SDK, so a field the
 * API returns cannot be forgotten; fields the emulator does not model take Stripe's empty values.
 */
import { createHash } from "node:crypto"
import type {
  CardDetails,
  Charge,
  CheckoutSession,
  Customer,
  DisplayPreference,
  Invoice,
  PaymentIntent,
  PaymentMethod,
  PaymentMethodConfiguration,
  Price,
  Product,
  SessionLine,
  StripeWebhookEndpoint,
} from "./entities.ts"

type Metadata = Record<string, string>

const noAddress = null

/** A 15-digit network transaction id, the same for the same charge. */
function networkTransactionId(chargeId: string): string {
  const digest = createHash("sha256").update(chargeId).digest()

  return BigInt(`0x${digest.subarray(0, 8).toString("hex")}`)
    .toString()
    .padStart(15, "0")
    .slice(0, 15)
}

/** A card number's fingerprint: the same card always gets the same one. */
function fingerprintOf(brand: string, last4: string): string {
  return createHash("sha256")
    .update(`${brand}:${last4}`)
    .digest("base64url")
    .replaceAll(/[-_]/g, "")
    .slice(0, 16)
}

/** A billing address nobody filled in: every part present, all of them null. */
const blankAddress = {
  city: null,
  country: null,
  line1: null,
  line2: null,
  postal_code: null,
  state: null,
}

export function customerObject(fields: {
  id: string
  created: number
  email: string | null
  name: string | null
  description: string | null
  phone: string | null
  metadata: Metadata
}): Customer {
  return {
    id: fields.id,
    object: "customer",
    address: noAddress,
    balance: 0,
    created: fields.created,
    currency: null,
    customer_account: null,
    default_source: null,
    delinquent: false,
    discount: null,
    description: fields.description,
    email: fields.email,
    invoice_prefix: fields.id.slice(4, 12).toUpperCase(),
    invoice_settings: {
      custom_fields: null,
      default_payment_method: null,
      footer: null,
      rendering_options: null,
    },
    livemode: false,
    metadata: fields.metadata,
    name: fields.name,
    next_invoice_sequence: 1,
    phone: fields.phone,
    preferred_locales: [],
    shipping: null,
    tax_exempt: "none",
    test_clock: null,
  }
}

export function productObject(fields: {
  id: string
  created: number
  name: string
  description: string | null
  active: boolean
  metadata: Metadata
  /** The product tax code, e.g. `txcd_10000000`, as Stripe Tax uses it. */
  taxCode?: string | null
}): Product & { attributes: string[] } {
  return {
    id: fields.id,
    object: "product",
    active: fields.active,
    attributes: [],
    created: fields.created,
    default_price: null,
    description: fields.description,
    images: [],
    livemode: false,
    marketing_features: [],
    metadata: fields.metadata,
    name: fields.name,
    package_dimensions: null,
    shippable: null,
    statement_descriptor: null,
    tax_code: fields.taxCode ?? null,
    tax_details: null,
    type: "service",
    unit_label: null,
    updated: fields.created,
    url: null,
  }
}

export function priceObject(fields: {
  id: string
  created: number
  product: string
  currency: string
  unitAmount: number
  active: boolean
  nickname: string | null
  lookupKey: string | null
  taxBehavior: "exclusive" | "inclusive" | "unspecified" | null
  recurring: { interval: "day" | "week" | "month" | "year"; interval_count: number } | null
  metadata: Metadata
}): Price {
  return {
    id: fields.id,
    object: "price",
    active: fields.active,
    billing_scheme: "per_unit",
    created: fields.created,
    currency: fields.currency,
    custom_unit_amount: null,
    livemode: false,
    lookup_key: fields.lookupKey,
    metadata: fields.metadata,
    nickname: fields.nickname,
    product: fields.product,
    recurring: fields.recurring && {
      interval: fields.recurring.interval,
      interval_count: fields.recurring.interval_count,
      meter: null,
      trial_period_days: null,
      usage_type: "licensed",
    },
    tax_behavior: fields.taxBehavior,
    tiers_mode: null,
    transform_quantity: null,
    type: fields.recurring ? "recurring" : "one_time",
    unit_amount: fields.unitAmount,
    unit_amount_decimal: String(fields.unitAmount),
  }
}

export function paymentIntentObject(fields: {
  id: string
  created: number
  amount: number
  currency: string
  customer: string | null
  description: string | null
  paymentMethod: string | null
  setupFutureUsage: "off_session" | "on_session" | null
  metadata: Metadata
  receiptEmail: string | null
  automaticPaymentMethods?: { enabled: boolean; allow_redirects: "always" | "never" } | null
  /** The payment method configuration an intent with dynamic payment methods draws from. */
  configuration?: string | null
}): PaymentIntent & { shared_payment_granted_token: null } {
  return {
    id: fields.id,
    object: "payment_intent",
    allowed_payment_method_types: null,
    amount: fields.amount,
    amount_capturable: 0,
    amount_details: { tip: {} },
    amount_received: 0,
    application: null,
    application_fee_amount: null,
    automatic_payment_methods: fields.automaticPaymentMethods ?? null,
    canceled_at: null,
    cancellation_reason: null,
    capture_method: "automatic",
    client_secret: `${fields.id}_secret_${fields.id.slice(3, 27).split("").toReversed().join("")}`,
    confirmation_method: "automatic",
    created: fields.created,
    currency: fields.currency,
    customer: fields.customer,
    customer_account: null,
    description: fields.description,
    excluded_payment_method_types: null,
    last_payment_error: null,
    latest_charge: null,
    livemode: false,
    managed_payments: { enabled: false },
    metadata: fields.metadata,
    next_action: null,
    on_behalf_of: null,
    payment_method: fields.paymentMethod,
    payment_method_configuration_details: fields.configuration
      ? { id: fields.configuration, parent: null }
      : null,
    payment_method_options: {
      card: {
        installments: null,
        mandate_options: null,
        network: null,
        request_three_d_secure: "automatic",
      },
      link: { persistent_token: null },
    },
    payment_method_types: ["card"],
    payment_record: null,
    processing: null,
    receipt_email: fields.receiptEmail,
    review: null,
    setup_future_usage: fields.setupFutureUsage,
    shared_payment_granted_token: null,
    shipping: null,
    source: null,
    statement_descriptor: null,
    statement_descriptor_suffix: null,
    status: fields.paymentMethod ? "requires_confirmation" : "requires_payment_method",
    transfer_data: null,
    transfer_group: null,
  }
}

/** A charge that went through: authorized by the card network and captured at once. */
export function chargeObject(fields: {
  id: string
  created: number
  intent: PaymentIntent
  paymentMethod: string
  card: CardDetails | null
  receiptUrl: string
}): Charge & { destination: null; dispute: null; order: null } {
  const { intent } = fields

  return {
    id: fields.id,
    object: "charge",
    amount: intent.amount,
    amount_captured: intent.amount,
    amount_refunded: 0,
    application: null,
    application_fee: null,
    application_fee_amount: null,
    balance_transaction: null,
    billing_details: { address: blankAddress, email: null, name: null, phone: null, tax_id: null },
    calculated_statement_descriptor: "DANWO",
    captured: true,
    created: fields.created,
    currency: intent.currency,
    customer: typeof intent.customer === "string" ? intent.customer : null,
    description: intent.description,
    destination: null,
    dispute: null,
    disputed: false,
    failure_balance_transaction: null,
    failure_code: null,
    failure_message: null,
    fraud_details: {},
    livemode: false,
    metadata: intent.metadata,
    on_behalf_of: null,
    order: null,
    outcome: {
      advice_code: null,
      network_advice_code: null,
      network_decline_code: null,
      network_status: "approved_by_network",
      reason: null,
      risk_level: "normal",
      risk_score: 32,
      seller_message: "Payment complete.",
      type: "authorized",
    },
    paid: true,
    payment_intent: intent.id,
    payment_method: fields.paymentMethod,
    payment_method_details: fields.card && {
      type: "card",
      card: {
        amount_authorized: intent.amount,
        authorization_code: "123456",
        brand: fields.card.brand,
        checks: { address_line1_check: null, address_postal_code_check: null, cvc_check: "pass" },
        country: fields.card.country,
        electronic_commerce_indicator: "07",
        exp_month: fields.card.exp_month,
        exp_year: fields.card.exp_year,
        extended_authorization: { status: "disabled" },
        fingerprint: fields.card.fingerprint ?? null,
        funding: fields.card.funding,
        incremental_authorization: { status: "unavailable" },
        installments: null,
        last4: fields.card.last4,
        mandate: null,
        multicapture: { status: "unavailable" },
        network: fields.card.brand,
        network_token: { used: false },
        network_transaction_id: networkTransactionId(fields.id),
        overcapture: { maximum_amount_capturable: intent.amount, status: "unavailable" },
        regulated_status: "unregulated",
        three_d_secure: null,
        transaction_link_id: null,
        wallet: null,
      },
    },
    radar_options: {},
    receipt_email: intent.receipt_email,
    receipt_number: null,
    receipt_url: fields.receiptUrl,
    refunded: false,
    review: null,
    shipping: null,
    source: null,
    source_transfer: null,
    statement_descriptor: null,
    statement_descriptor_suffix: null,
    status: "succeeded",
    transfer_data: null,
    transfer_group: null,
  }
}

export function paymentMethodObject(fields: {
  id: string
  created: number
  customer: string | null
  card: CardDetails
  metadata: Metadata
}): PaymentMethod {
  return {
    id: fields.id,
    object: "payment_method",
    allow_redisplay: "unspecified",
    billing_details: { address: blankAddress, email: null, name: null, phone: null, tax_id: null },
    card: fields.card,
    created: fields.created,
    customer: fields.customer,
    customer_account: null,
    livemode: false,
    metadata: fields.metadata,
    type: "card",
  }
}

/** A card's details as a payment method shows them. */
export function cardDetails(card: {
  brand: string
  last4: string
  funding: string
  country: string
  expMonth: number
  expYear: number
}): CardDetails {
  return {
    brand: card.brand,
    checks: { address_line1_check: null, address_postal_code_check: null, cvc_check: "pass" },
    country: card.country,
    display_brand: card.brand,
    exp_month: card.expMonth,
    exp_year: card.expYear,
    fingerprint: fingerprintOf(card.brand, card.last4),
    funding: card.funding,
    generated_from: null,
    last4: card.last4,
    networks: { available: [card.brand], preferred: null },
    regulated_status: "unregulated",
    three_d_secure_usage: { supported: true },
    wallet: null,
  }
}

/** What a session's creator chose; the rest of a fresh session is fixed. */
type SessionFields = {
  id: string
  created: number
  url: string
  mode: "payment" | "setup" | "subscription"
  lines: readonly SessionLine[]
  customer: string | null
  customerEmail: string | null
  clientReferenceId: string | null
  successUrl: string | null
  cancelUrl: string | null
  expiresAt: number
  metadata: Metadata
  configuration: string | null
  invoiceCreation: { description: string | null; metadata: Metadata } | null
}

/** Fields that depend on whether the session takes a payment (every mode but `setup`). */
function sessionPricing(
  fields: SessionFields,
): Pick<
  CheckoutSession,
  "amount_subtotal" | "amount_total" | "invoice_creation" | "payment_status" | "total_details"
> {
  if (fields.mode === "setup")
    return {
      amount_subtotal: null,
      amount_total: null,
      invoice_creation: null,
      payment_status: "no_payment_required",
      total_details: null,
    }

  const total = fields.lines.reduce((sum, line) => sum + line.unitAmount * line.quantity, 0)

  return {
    amount_subtotal: total,
    amount_total: total,
    invoice_creation: {
      enabled: fields.invoiceCreation !== null,
      invoice_data: {
        account_tax_ids: null,
        custom_fields: null,
        description: fields.invoiceCreation?.description ?? null,
        footer: null,
        issuer: null,
        metadata: fields.invoiceCreation?.metadata ?? {},
        rendering_options: null,
      },
    },
    payment_status: "unpaid",
    total_details: { amount_discount: 0, amount_shipping: 0, amount_tax: 0 },
  }
}

export function checkoutSessionObject(fields: SessionFields): CheckoutSession {
  return {
    id: fields.id,
    object: "checkout.session",
    adaptive_pricing: { enabled: false },
    after_expiration: null,
    allow_promotion_codes: null,
    allowed_payment_method_types: null,
    ...sessionPricing(fields),
    automatic_tax: { enabled: false, liability: null, provider: null, status: null },
    billing_address_collection: null,
    cancel_url: fields.cancelUrl,
    client_reference_id: fields.clientReferenceId,
    client_secret: null,
    collected_information: null,
    consent: null,
    consent_collection: null,
    created: fields.created,
    currency: fields.lines[0]?.currency ?? null,
    currency_conversion: null,
    custom_fields: [],
    custom_text: {
      after_submit: null,
      shipping_address: null,
      submit: null,
      terms_of_service_acceptance: null,
    },
    customer: fields.customer,
    customer_account: null,
    customer_creation: fields.customer ? null : "if_required",
    customer_details: null,
    customer_email: fields.customerEmail,
    discounts: [],
    expires_at: fields.expiresAt,
    integration_identifier: null,
    invoice: null,
    livemode: false,
    locale: null,
    managed_payments: null,
    metadata: fields.metadata,
    mode: fields.mode,
    origin_context: null,
    payment_intent: null,
    payment_link: null,
    payment_method_collection: "always",
    payment_method_configuration_details: fields.configuration
      ? { id: fields.configuration, parent: null }
      : null,
    payment_method_options: {},
    payment_method_types: ["card"],
    permissions: null,
    recovered_from: null,
    saved_payment_method_options: null,
    setup_intent: null,
    shipping_address_collection: null,
    shipping_cost: null,
    shipping_options: [],
    status: "open",
    submit_type: null,
    subscription: null,
    success_url: fields.successUrl,
    ui_mode: "hosted",
    url: fields.url,
    wallet_options: null,
  }
}

/** A paid one-off invoice, as Checkout's `invoice_creation` produces after a payment. */
export function invoiceObject(fields: {
  id: string
  number: string
  created: number
  customer: string | null
  customerEmail: string | null
  currency: string
  lines: readonly SessionLine[]
  description: string | null
  metadata: Metadata
  hostedUrl: string
}): Invoice {
  const total = fields.lines.reduce((sum, line) => sum + line.unitAmount * line.quantity, 0)

  return {
    id: fields.id,
    object: "invoice",
    account_country: "US",
    account_name: "danwo",
    account_tax_ids: null,
    amount_due: total,
    amount_overpaid: 0,
    amount_paid: 0,
    amount_remaining: total,
    amount_shipping: 0,
    application: null,
    attempt_count: 0,
    attempted: false,
    auto_advance: false,
    automatic_tax: {
      disabled_reason: null,
      enabled: false,
      liability: null,
      provider: null,
      status: null,
    },
    automatically_finalizes_at: null,
    billing_reason: "manual",
    collection_method: "charge_automatically",
    created: fields.created,
    currency: fields.currency,
    custom_fields: null,
    customer: fields.customer,
    customer_account: null,
    customer_address: null,
    customer_email: fields.customerEmail,
    customer_name: null,
    customer_phone: null,
    customer_shipping: null,
    customer_tax_exempt: "none",
    default_payment_method: null,
    default_source: null,
    default_tax_rates: [],
    description: fields.description,
    discounts: [],
    due_date: null,
    effective_at: null,
    ending_balance: null,
    footer: null,
    from_invoice: null,
    hosted_invoice_url: fields.hostedUrl,
    invoice_pdf: `${fields.hostedUrl}/pdf`,
    issuer: { type: "self" },
    last_finalization_error: null,
    latest_revision: null,
    lines: {
      object: "list",
      data: fields.lines.map((line, index) => ({
        id: `il_${fields.id.slice(3)}${index}`,
        object: "line_item",
        amount: line.unitAmount * line.quantity,
        currency: line.currency,
        description: line.description,
        discount_amounts: [],
        discountable: true,
        discounts: [],
        invoice: fields.id,
        livemode: false,
        metadata: {},
        parent: null,
        period: { end: fields.created, start: fields.created },
        pretax_credit_amounts: [],
        pricing: {
          type: "price_details",
          price_details: { price: line.price, product: "" },
          unit_amount_decimal: String(line.unitAmount),
        },
        quantity: line.quantity,
        quantity_decimal: String(line.quantity),
        subscription: null,
        subtotal: line.unitAmount * line.quantity,
        taxes: [],
      })),
      has_more: false,
      url: `/v1/invoices/${fields.id}/lines`,
    },
    livemode: false,
    metadata: fields.metadata,
    next_payment_attempt: null,
    number: fields.number,
    on_behalf_of: null,
    parent: null,
    payment_settings: {
      default_mandate: null,
      payment_method_options: null,
      payment_method_types: null,
    },
    period_end: fields.created,
    period_start: fields.created,
    post_payment_credit_notes_amount: 0,
    pre_payment_credit_notes_amount: 0,
    receipt_number: null,
    rendering: null,
    shipping_cost: null,
    shipping_details: null,
    starting_balance: 0,
    statement_descriptor: null,
    status: "draft",
    status_transitions: {
      finalized_at: null,
      marked_uncollectible_at: null,
      paid_at: null,
      voided_at: null,
    },
    subtotal: total,
    subtotal_excluding_tax: total,
    test_clock: null,
    total,
    total_discount_amounts: [],
    total_excluding_tax: total,
    total_pretax_credit_amounts: [],
    total_taxes: [],
    webhooks_delivered_at: null,
  }
}

/** Payment methods a configuration lists, and what a fresh test account shows for each. */
export const CONFIGURABLE_METHODS: Readonly<Record<string, DisplayPreference>> = {
  card: "on",
  link: "on",
  apple_pay: "on",
  google_pay: "on",
  cashapp: "off",
  klarna: "off",
  affirm: "off",
  us_bank_account: "off",
}

export function paymentMethodConfigurationObject(fields: {
  id: string
  name: string
  active: boolean
  isDefault: boolean
  preferences: Readonly<Record<string, DisplayPreference>>
}): PaymentMethodConfiguration {
  const methods = Object.fromEntries(
    Object.entries(CONFIGURABLE_METHODS).map(([method, fallback]) => {
      const preference = fields.preferences[method] ?? fallback

      return [
        method,
        {
          available: preference === "on",
          display_preference: {
            overridable: null,
            preference,
            value: preference === "on" ? "on" : "off",
          },
        },
      ]
    }),
  )

  return {
    id: fields.id,
    object: "payment_method_configuration",
    active: fields.active,
    application: null,
    is_default: fields.isDefault,
    livemode: false,
    name: fields.name,
    parent: null,
    ...methods,
  }
}

export function webhookEndpointObject(fields: {
  id: string
  created: number
  url: string
  events: string[]
  description: string | null
  metadata: Metadata
  apiVersion: string | null
}): StripeWebhookEndpoint {
  return {
    id: fields.id,
    object: "webhook_endpoint",
    api_version: fields.apiVersion,
    application: null,
    created: fields.created,
    description: fields.description,
    enabled_events: fields.events,
    livemode: false,
    metadata: fields.metadata,
    status: "enabled",
    url: fields.url,
  }
}
