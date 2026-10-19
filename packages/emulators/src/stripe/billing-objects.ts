/**
 * The billing objects as the API answers them: plans, subscriptions and their items, the
 * invoices a subscription bills, setup intents and billing portal sessions. Shapes follow the
 * `stripe` SDK's types and what test mode sends for the pinned API version.
 */
import type {
  BillingPortalSession,
  Invoice,
  Plan,
  Price,
  SetupIntent,
  Subscription,
  SubscriptionItem,
} from "./entities.ts"
import { invoiceObject } from "./formatters.ts"
import { idOf } from "./helpers.ts"

type Metadata = Record<string, string>

/** The legacy plan a recurring price stands for, as subscription items still carry it. */
function planOf(price: Price): Plan {
  return {
    id: price.id,
    object: "plan",
    active: price.active,
    amount: price.unit_amount,
    amount_decimal: price.unit_amount_decimal,
    billing_scheme: "per_unit",
    created: price.created,
    currency: price.currency,
    interval: price.recurring?.interval ?? "month",
    interval_count: price.recurring?.interval_count ?? 1,
    livemode: false,
    metadata: price.metadata,
    meter: null,
    nickname: price.nickname,
    product: price.product,
    tiers_mode: null,
    transform_usage: null,
    trial_period_days: null,
    usage_type: "licensed",
  }
}

/** One price on a subscription, with the period it is billed for. */
export function subscriptionItemObject(fields: {
  id: string
  created: number
  subscription: string
  price: Price
  quantity: number
  periodStart: number
  periodEnd: number
  metadata: Metadata
}): SubscriptionItem {
  return {
    id: fields.id,
    object: "subscription_item",
    billing_thresholds: null,
    created: fields.created,
    current_period_end: fields.periodEnd,
    current_period_start: fields.periodStart,
    current_trial: null,
    discounts: [],
    metadata: fields.metadata,
    plan: planOf(fields.price),
    price: fields.price,
    quantity: fields.quantity,
    subscription: fields.subscription,
    tax_rates: [],
  }
}

/** What a subscription does when its trial ends without a payment method. */
export type MissingPaymentMethod = "cancel" | "create_invoice" | "pause"

/** A new subscription; its status, invoice and items are filled in as it is billed. */
export function subscriptionObject(fields: {
  id: string
  created: number
  customer: string
  currency: string
  items: readonly SubscriptionItem[]
  status: Subscription["status"]
  trialStart: number | null
  trialEnd: number | null
  missingPaymentMethod: MissingPaymentMethod
  defaultPaymentMethod: string | null
  description: string | null
  metadata: Metadata
  saveDefaultPaymentMethod: "off" | "on_subscription"
}): Subscription {
  const first = fields.items[0]

  return {
    id: fields.id,
    object: "subscription",
    application: null,
    application_fee_percent: null,
    automatic_tax: { disabled_reason: null, enabled: false, liability: null },
    billing_cycle_anchor: fields.trialEnd ?? fields.created,
    billing_cycle_anchor_config: null,
    billing_mode: {
      flexible: { proration_discounts: "included" },
      type: "flexible",
      updated_at: fields.created,
    },
    billing_schedules: [],
    billing_thresholds: null,
    cancel_at: null,
    cancel_at_period_end: false,
    canceled_at: null,
    cancellation_details: { comment: null, feedback: null, feedback_option: null, reason: null },
    collection_method: "charge_automatically",
    created: fields.created,
    currency: fields.currency,
    customer: fields.customer,
    customer_account: null,
    days_until_due: null,
    default_payment_method: fields.defaultPaymentMethod,
    default_source: null,
    default_tax_rates: [],
    description: fields.description,
    discounts: [],
    ended_at: null,
    invoice_settings: {
      account_tax_ids: null,
      custom_fields: null,
      description: null,
      footer: null,
      issuer: { type: "self" },
    },
    items: {
      object: "list",
      data: [...fields.items],
      has_more: false,
      url: `/v1/subscription_items?subscription=${fields.id}`,
    },
    latest_invoice: null,
    livemode: false,
    managed_payments: { enabled: false },
    metadata: fields.metadata,
    next_pending_invoice_item_invoice: null,
    on_behalf_of: null,
    pause_collection: null,
    payment_settings: {
      payment_method_options: null,
      payment_method_types: null,
      save_default_payment_method: fields.saveDefaultPaymentMethod,
    },
    pending_invoice_item_interval: null,
    pending_setup_intent: null,
    pending_update: null,
    plan: first ? first.plan : null,
    quantity: first?.quantity ?? null,
    schedule: null,
    start_date: fields.created,
    status: fields.status,
    test_clock: null,
    transfer_data: null,
    trial_end: fields.trialEnd,
    trial_settings: {
      end_behavior: {
        billing_cycle_anchor: "now",
        missing_payment_method: fields.missingPaymentMethod,
      },
    },
    trial_start: fields.trialStart,
  }
}

/** Why a subscription invoice was made. */
export type BillingReason = "subscription_create" | "subscription_cycle" | "subscription_update"

/** The invoice a subscription bills for one period, as a draft. */
export function subscriptionInvoiceObject(fields: {
  id: string
  number: string
  created: number
  subscription: Subscription
  customerEmail: string | null
  reason: BillingReason
  /** Each item's amount for the period: zero during a trial. */
  amounts: readonly number[]
  productNames: readonly string[]
  hostedUrl: string
}): Invoice {
  const items = fields.subscription.items.data
  const base = invoiceObject({
    id: fields.id,
    number: fields.number,
    created: fields.created,
    customer:
      typeof fields.subscription.customer === "string" ? fields.subscription.customer : null,
    customerEmail: fields.customerEmail,
    currency: fields.subscription.currency,
    lines: items.map((item, index) => ({
      price: item.price.id,
      quantity: item.quantity ?? 1,
      description: lineDescription(item, fields.productNames[index] ?? "", fields.amounts[index]),
      unitAmount: (fields.amounts[index] ?? 0) / Math.max(1, item.quantity ?? 1),
      currency: item.price.currency,
    })),
    description: null,
    metadata: {},
    hostedUrl: fields.hostedUrl,
  })

  return {
    ...base,
    auto_advance: true,
    billing_reason: fields.reason,
    customer_tax_ids: [],
    lines: {
      ...base.lines,
      data: base.lines.data.flatMap((line, index) => {
        const item = items[index]

        return item ? [subscriptionLine(line, item, fields.subscription.id)] : []
      }),
    },
    parent: {
      quote_details: null,
      subscription_details: {
        metadata: fields.subscription.metadata,
        subscription: fields.subscription.id,
      },
      type: "subscription_details",
    },
  }
}

/** `1 × Pro (at $20.00 / month)`, or the trial's `Trial period for Pro`. */
function lineDescription(item: SubscriptionItem, product: string, amount: number | undefined) {
  if (amount === 0 && (item.price.unit_amount ?? 0) > 0) return `Trial period for ${product}`

  const unit = (item.price.unit_amount ?? 0) / 100
  const interval = item.price.recurring?.interval ?? "month"

  return `${item.quantity ?? 1} × ${product} (at $${unit.toFixed(2)} / ${interval})`
}

/** One line of a subscription invoice, tied to its subscription item and period. */
function subscriptionLine(
  line: Invoice["lines"]["data"][number],
  item: SubscriptionItem,
  subscription: string,
): Invoice["lines"]["data"][number] {
  return {
    ...line,
    parent: {
      invoice_item_details: null,
      subscription_item_details: {
        invoice_item: null,
        proration: false,
        proration_details: { credited_items: null },
        subscription,
        subscription_item: item.id,
      },
      type: "subscription_item_details",
    },
    period: { start: item.current_period_start, end: item.current_period_end },
    pricing: {
      type: "price_details",
      price_details: { price: item.price.id, product: idOf(item.price.product) },
      unit_amount_decimal: line.pricing?.unit_amount_decimal ?? "0",
    },
  }
}

/** A new SetupIntent, waiting for a payment method unless it was given one. */
export function setupIntentObject(fields: {
  id: string
  created: number
  customer: string | null
  paymentMethod: string | null
  usage: "off_session" | "on_session"
  description: string | null
  metadata: Metadata
  configuration: string | null
}): SetupIntent {
  return {
    id: fields.id,
    object: "setup_intent",
    allowed_payment_method_types: null,
    application: null,
    automatic_payment_methods: { allow_redirects: "always", enabled: true },
    cancellation_reason: null,
    client_secret: `${fields.id}_secret_${fields.id.slice(5)}`,
    created: fields.created,
    customer: fields.customer,
    customer_account: null,
    description: fields.description,
    excluded_payment_method_types: null,
    flow_directions: null,
    last_setup_error: null,
    latest_attempt: null,
    livemode: false,
    managed_payments: { enabled: false },
    mandate: null,
    metadata: fields.metadata,
    next_action: null,
    on_behalf_of: null,
    payment_method: fields.paymentMethod,
    payment_method_configuration_details: fields.configuration
      ? { id: fields.configuration, parent: null }
      : null,
    payment_method_options: {
      card: { mandate_options: null, network: null, request_three_d_secure: "automatic" },
    },
    payment_method_types: ["card"],
    single_use_mandate: null,
    status: fields.paymentMethod ? "requires_confirmation" : "requires_payment_method",
    usage: fields.usage,
  }
}

/** A customer's session on the hosted billing portal. */
export function portalSessionObject(fields: {
  id: string
  created: number
  customer: string
  returnUrl: string | null
  url: string
}): BillingPortalSession {
  return {
    id: fields.id,
    object: "billing_portal.session",
    configuration: "bpc_danwo_default",
    created: fields.created,
    customer: fields.customer,
    customer_account: null,
    flow: null,
    livemode: false,
    locale: null,
    on_behalf_of: null,
    return_url: fields.returnUrl,
    url: fields.url,
  }
}
