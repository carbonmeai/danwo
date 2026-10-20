/**
 * What happens to money after a call: a transaction paid or failed, the customer's card saved, a
 * subscription started and renewed on the emulator's clock, and the events each step sends.
 */
import type { PaystackRouteContext } from "./context.ts"
import type {
  Authorization,
  Customer,
  Integration,
  Plan,
  Subscription,
  Transaction,
  TransactionExtra,
} from "./entities.ts"
import { customerObject, feeFor, subscriptionObject, transactionObject } from "./formatters.ts"
import { newAccessCode, newReference, newToken, nextId } from "./helpers.ts"
import { emitEvent } from "./signature.ts"

const HOUR = 3_600_000
const DAY = 24 * HOUR

/** How long each plan interval lasts. */
const INTERVAL_MS: Readonly<Record<Plan["interval"], number>> = {
  hourly: HOUR,
  daily: DAY,
  weekly: 7 * DAY,
  monthly: 30 * DAY,
  quarterly: 91 * DAY,
  biannually: 182 * DAY,
  annually: 365 * DAY,
}

/** How a transaction was paid. */
export interface Payment {
  readonly channel: string
  readonly authorization: Authorization
  readonly gatewayResponse?: string
}

/** A transaction to start: who pays, how much, and what for. */
export interface NewTransaction {
  readonly integration: Integration
  readonly email: string
  readonly amount: number
  readonly currency: string
  readonly reference?: string | undefined
  readonly metadata: Transaction["metadata"]
  /** The caller's address, for a payment started by an API call; none for one Paystack starts. */
  readonly ipAddress?: string | undefined
  readonly callbackUrl: string | null
  readonly channels: readonly string[]
  readonly plan: Plan | null
}

/** What payments need from the emulator: the objects, the clock and the timer, and the event outbox. */
export type PaymentsContext = Pick<
  PaystackRouteContext,
  "paystack" | "store" | "outbox" | "clock" | "timer"
>

export class PaystackPayments {
  private readonly context: PaymentsContext

  constructor(context: PaymentsContext) {
    this.context = context
  }

  /** The integration's customer with `email`, created the first time it is used. */
  customerFor(integration: Integration, email: string): Customer {
    const { paystack, store, clock } = this.context
    const existing = paystack.customers.where(
      (customer) =>
        customer.email === email.toLowerCase() && customer.integration === integration.number,
    )[0]

    return (
      existing ??
      paystack.customers.add(
        customerObject({ id: nextId(store), email, integration, now: clock() }),
        null,
      )
    )
  }

  /** Stores an initialized transaction, payable on the hosted page by its access code. */
  start(input: NewTransaction): { transaction: Transaction; extra: TransactionExtra } {
    const { paystack, store, clock } = this.context
    const extra: TransactionExtra = {
      accessCode: newAccessCode(),
      callbackUrl: input.callbackUrl ?? input.integration.callbackUrl,
      channels: input.channels,
      plan: input.plan?.plan_code ?? null,
      pendingCard: null,
    }
    const transaction = paystack.transactions.add(
      transactionObject({
        id: nextId(store),
        reference: input.reference ?? newReference(),
        amount: input.plan?.amount ?? input.amount,
        currency: input.currency,
        customer: this.customerFor(input.integration, input.email),
        metadata: input.metadata,
        plan: input.plan,
        ipAddress: input.ipAddress ?? null,
        now: clock(),
      }),
      extra,
    )

    return { transaction, extra }
  }

  /** Marks a transaction paid, saves the authorization to its customer and sends `charge.success`. */
  succeed(reference: string, payment: Payment): Transaction | undefined {
    const { paystack, clock, outbox } = this.context
    const now = clock().toISOString()
    const paid = paystack.transactions.change(reference, {
      status: "success",
      channel: payment.channel,
      gateway_response: payment.gatewayResponse ?? "Successful",
      message: null,
      paid_at: now,
      paidAt: now,
      fees: feeFor(paystack.transactions.get(reference)?.amount ?? 0),
      authorization: payment.authorization,
    })

    if (paid === undefined) return undefined

    if (!paystack.authorizations.get(payment.authorization.authorization_code))
      paystack.authorizations.add(payment.authorization, { customer: paid.customer.customer_code })

    emitEvent(outbox, "charge.success", paid)
    this.subscribeAfterPayment(paid, payment.authorization)

    return paid
  }

  /** Marks a charge failed with the bank's answer; Paystack sends no event for it. */
  decline(reference: string, gatewayResponse: string): Transaction | undefined {
    return this.context.paystack.transactions.change(reference, {
      status: "failed",
      gateway_response: gatewayResponse,
      message: gatewayResponse,
    })
  }

  /** Charges a saved authorization at once, as `charge_authorization` and renewals do. */
  chargeSaved(input: NewTransaction, authorization: Authorization): Transaction | undefined {
    const { transaction } = this.start(input)

    if (!authorization.reusable) return this.decline(transaction.reference, "Declined")

    return this.succeed(transaction.reference, {
      channel: authorization.channel,
      authorization,
      gatewayResponse: "Approved",
    })
  }

  /** Puts `customer` on `plan`, charged on `authorization` from the next interval on. */
  subscribe(plan: Plan, customer: Customer, authorization: Authorization): Subscription {
    const { paystack, store, clock, outbox } = this.context
    const start = clock()
    const subscription = paystack.subscriptions.add(
      subscriptionObject({
        id: nextId(store),
        customer,
        plan,
        authorization,
        start,
        nextPayment: new Date(start.getTime() + INTERVAL_MS[plan.interval]),
        emailToken: newToken(),
      }),
      null,
    )

    emitEvent(outbox, "subscription.create", subscription)
    this.scheduleRenewal(subscription)

    return subscription
  }

  /** Stops renewals and sends `subscription.disable`. */
  disable(code: string): Subscription | undefined {
    const disabled = this.context.paystack.subscriptions.change(code, {
      status: "cancelled",
      next_payment_date: null,
    })

    if (disabled) emitEvent(this.context.outbox, "subscription.disable", disabled)

    return disabled
  }

  /** Starts renewals again on a cancelled subscription. */
  enable(code: string): Subscription | undefined {
    const { paystack, clock } = this.context
    const subscription = paystack.subscriptions.get(code)

    if (subscription === undefined) return undefined

    const plan = paystack.plans.get(subscription.plan.plan_code)
    const next = new Date(clock().getTime() + INTERVAL_MS[subscription.plan.interval])
    const enabled = paystack.subscriptions.change(code, {
      status: "active",
      next_payment_date: next.toISOString(),
    })

    if (enabled && plan) this.scheduleRenewal(enabled)

    return enabled
  }

  /** A transaction for a plan subscribes its customer once paid, as initializing with `plan` does. */
  private subscribeAfterPayment(paid: Transaction, authorization: Authorization): void {
    const { paystack } = this.context
    const planCode = paystack.transactions.extra(paid.reference)?.plan ?? null
    const plan = planCode === null ? undefined : paystack.plans.get(planCode)
    const customer = paystack.customers.get(paid.customer.customer_code)

    if (plan && customer) this.subscribe(plan, customer, authorization)
  }

  private scheduleRenewal(subscription: Subscription): void {
    const { timer, clock } = this.context
    const due = Date.parse(subscription.next_payment_date ?? "")

    if (Number.isNaN(due)) return

    timer.setTimeout(() => this.renew(subscription.subscription_code), due - clock().getTime(), {
      background: true,
    })
  }

  /** One renewal: an invoice, a charge on the saved authorization, then the invoice's outcome. */
  private renew(code: string): void {
    const { paystack, outbox } = this.context
    const subscription = paystack.subscriptions.get(code)
    const integration = paystack.integrations
      .all()
      .find((candidate) => candidate.number === subscription?.integration)

    if (subscription?.status !== "active" || integration === undefined) return

    const invoice = {
      subscription: summaryOfSubscription(subscription),
      amount: subscription.amount,
    }

    emitEvent(outbox, "invoice.create", invoice)

    const charged = this.chargeSaved(
      {
        integration,
        email: subscription.customer.email,
        amount: subscription.amount,
        currency: subscription.plan.currency,
        metadata: { renewal: subscription.subscription_code },
        callbackUrl: null,
        channels: ["card"],
        plan: null,
      },
      subscription.authorization,
    )

    this.afterRenewal(subscription, charged, invoice)
  }

  private afterRenewal(
    subscription: Subscription,
    charged: Transaction | undefined,
    invoice: object,
  ): void {
    const { paystack, outbox, clock } = this.context

    if (charged?.status !== "success") {
      paystack.subscriptions.change(subscription.subscription_code, { status: "attention" })
      emitEvent(outbox, "invoice.payment_failed", { ...invoice, paid: false })

      return
    }

    const payments = subscription.payments_count + 1
    const done = subscription.invoice_limit > 0 && payments >= subscription.invoice_limit
    const next = new Date(clock().getTime() + INTERVAL_MS[subscription.plan.interval])
    const renewed = paystack.subscriptions.change(subscription.subscription_code, {
      payments_count: payments,
      status: done ? "completed" : "active",
      next_payment_date: done ? null : next.toISOString(),
    })

    emitEvent(outbox, "invoice.update", { ...invoice, paid: true, transaction: charged })
    if (renewed && !done) this.scheduleRenewal(renewed)
  }
}

/** The subscription fields an invoice event carries. */
function summaryOfSubscription(subscription: Subscription): object {
  return {
    subscription_code: subscription.subscription_code,
    email_token: subscription.email_token,
    amount: subscription.amount,
    status: subscription.status,
    next_payment_date: subscription.next_payment_date,
  }
}
