import type { Emulator } from "../define.ts"
import { App } from "../http.ts"
import { systemTimer } from "../time.ts"
import { replaceCard } from "./billing.ts"
import { recordDeposit, saveCard } from "./charges.ts"
import type { BachsContext } from "./context.ts"
import { runDue } from "./due.ts"
import type { RecoveryEmail } from "./entities.ts"
import { BachsEvents } from "./events.ts"
import {
  checkoutObject,
  payoutObject,
  paymentObject,
  refundObject,
  subscriptionObject,
} from "./formatters.ts"
import { bachsId, BachsFailure, iso, minorOf, money } from "./helpers.ts"
import { bachsStore } from "./store.ts"

/** A deposit someone makes into the account's virtual account. Amount as a decimal string. */
export interface BachsDeposit {
  readonly amount: string
  readonly currency?: string
  readonly senderName?: string | null
  readonly senderBank?: string | null
  readonly senderBankCode?: string | null
  readonly senderAccountNumber?: string | null
  readonly narration?: string | null
}

/** What a test can read from and do to a Bachs emulator. */
export interface BachsLedger {
  /** Every payment, oldest first, as the API returns them. */
  payments(): ReturnType<typeof paymentObject>[]
  /** Payments that succeeded (and were not refunded since), optionally only those with `reference`. */
  succeeded(reference?: string): ReturnType<typeof paymentObject>[]
  checkouts(): ReturnType<typeof checkoutObject>[]
  subscriptions(): ReturnType<typeof subscriptionObject>[]
  refunds(): ReturnType<typeof refundObject>[]
  payouts(): ReturnType<typeof payoutObject>[]
  /** What is available in `currency`, as a decimal string. */
  balance(currency: string): string
  /** Recovery emails sent after failed renewals, optionally only to `email`. */
  recoveryEmails(email?: string): RecoveryEmail[]
  /** Money arrives in the virtual account: a deposit payment and `collection.succeeded`. */
  deposit(deposit: BachsDeposit): ReturnType<typeof paymentObject>
  /** Makes a subscription's saved card decline from now on, so its next charge fails. */
  failCard(
    subscriptionId: string,
    reason?: "declined" | "insufficient_funds" | "expired_card",
  ): void
  /** The customer enters a new card (as on the recovery page): open invoices are charged again. */
  updateCard(subscriptionId: string, number?: string): ReturnType<typeof subscriptionObject>
  /** Runs the work due by now on the emulator's clock: settlements, expiries, renewals, retries. */
  catchUp(): void
}

const DECLINING: Readonly<Record<string, string>> = {
  declined: "4000000000000002",
  insufficient_funds: "4000000000009995",
  expired_card: "4000000000000069",
}

/** The context ledger actions run in: the emulator's state and outbox, with no timers of its own. */
function contextOf(emulator: Emulator): BachsContext {
  const bachs = bachsStore(emulator.store)

  return {
    app: new App(),
    bachs,
    events: new BachsEvents(bachs, emulator.outbox, emulator.store.clock),
    clock: emulator.store.clock,
    timer: systemTimer,
    wakeAt: () => undefined,
  }
}

function subscriptionOf(context: BachsContext, id: string) {
  return context.bachs.subscriptions.get(id) ?? fail(`no subscription ${id}`)
}

function fail(message: string): never {
  throw new BachsFailure(404, "NOT_FOUND", message)
}

/** Reads and drives a Bachs emulator from a test. */
export function bachsLedger(emulator: Emulator): BachsLedger {
  const context = contextOf(emulator)
  const { bachs } = context

  return {
    payments: () => bachs.payments.all().map((payment) => paymentObject(payment, bachs)),
    succeeded: (reference) =>
      bachs.payments
        .where(
          (payment) =>
            payment.status === "succeeded" &&
            (reference === undefined || payment.reference === reference),
        )
        .map((payment) => paymentObject(payment, bachs)),
    checkouts: () => bachs.checkouts.all().map((checkout) => checkoutObject(checkout, bachs)),
    subscriptions: () =>
      bachs.subscriptions.all().map((subscription) => subscriptionObject(subscription, bachs)),
    refunds: () =>
      bachs.refunds.all().map((refund) => refundObject(refund, refund.status === "success")),
    payouts: () => bachs.payouts.all().map(payoutObject),
    balance: (currency) => money(bachs.balances.get(currency)?.available ?? 0),
    recoveryEmails: (email) =>
      bachs.recoveryEmails.where((sent) => email === undefined || sent.email === email),
    deposit(deposit) {
      const account =
        bachs.virtualAccounts.all()[0] ??
        fail("the account has no virtual account; create one with POST /v1/virtual-accounts")
      const payment = recordDeposit(
        context,
        {
          senderName: deposit.senderName ?? null,
          senderBank: deposit.senderBank ?? null,
          senderBankCode: deposit.senderBankCode ?? null,
          senderAccountNumber: deposit.senderAccountNumber ?? null,
          narration: deposit.narration ?? null,
          sessionId: `0000${Date.parse(iso(context.clock()))}${bachsId("s", 6).slice(2)}`,
          virtualAccountId: account.id,
        },
        minorOf(deposit.amount) ?? fail(`not an amount: ${deposit.amount}`),
        deposit.currency ?? account.currency,
      )

      return paymentObject(payment, bachs)
    },
    failCard(subscriptionId, reason = "declined") {
      const subscription = subscriptionOf(context, subscriptionId)

      bachs.cards.change(subscription.paymentMethodId, {
        number: DECLINING[reason] ?? "4000000000000002",
      })
    },
    updateCard(subscriptionId, number = "4242424242424242") {
      const subscription = subscriptionOf(context, subscriptionId)

      return subscriptionObject(
        replaceCard(context, subscription, saveCard(context, subscription.customerId, number)),
        bachs,
      )
    },
    catchUp: () => runDue(context),
  }
}
