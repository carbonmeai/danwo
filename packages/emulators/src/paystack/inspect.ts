import type { Emulator } from "../define.ts"
import type { Customer, Refund, Subscription, Transaction, Transfer } from "./entities.ts"
import { channelAuthorization } from "./formatters.ts"
import { PaystackPayments } from "./payments.ts"
import { paystackStore } from "./store.ts"

/** What a test reads back from a Paystack emulator: the money it moved and who it moved it for. */
export interface PaystackLedger {
  /** Every transaction, oldest first, paid or not. */
  transactions(): Transaction[]
  /** One transaction by its reference. */
  transaction(reference: string): Transaction | undefined
  /** The transactions that were paid, optionally in one currency. */
  successful(currency?: string): Transaction[]
  /** The total paid, in subunits, optionally for one customer's email. */
  paidTotal(email?: string): number
  transfers(): Transfer[]
  refunds(): Refund[]
  customers(): Customer[]
  subscriptions(): Subscription[]
}

export function paystackLedger(emulator: Pick<Emulator, "store">): PaystackLedger {
  const paystack = paystackStore(emulator.store)
  const successful = (currency?: string) =>
    paystack.transactions.where(
      (t) => t.status === "success" && (currency === undefined || t.currency === currency),
    )

  return {
    transactions: () => paystack.transactions.all(),
    transaction: (reference) => paystack.transactions.get(reference),
    successful,
    paidTotal: (email) =>
      successful()
        .filter((t) => email === undefined || t.customer.email === email.toLowerCase())
        .reduce((sum, t) => sum + t.amount, 0),
    transfers: () => paystack.transfers.all(),
    refunds: () => paystack.refunds.all(),
    customers: () => paystack.customers.all(),
    subscriptions: () => paystack.subscriptions.all(),
  }
}

/** A bank outside Paystack, for tests: money sent to a customer's dedicated account. */
export interface PaystackBank {
  /**
   * Sends `amount` (in kobo) to a dedicated virtual account, as a customer paying by bank
   * transfer would: it becomes a paid transaction and a `charge.success` event.
   */
  transferTo(accountNumber: string, amount: number): Transaction
}

/** Runs nothing later: an inbound transfer schedules no follow-up work. */
const NO_TIMER = { setTimeout: () => undefined, clearTimeout: () => undefined }

export function paystackBank(emulator: Pick<Emulator, "store" | "outbox">): PaystackBank {
  const paystack = paystackStore(emulator.store)

  return {
    transferTo(accountNumber, amount) {
      const account = paystack.dedicated.get(accountNumber)
      const customer = account && paystack.customers.get(account.customer.customer_code)
      const integration = paystack.integrations
        .all()
        .find((i) => i.number === customer?.integration)

      if (account === undefined || customer === undefined || integration === undefined)
        throw new Error(`no dedicated account ${accountNumber}`)

      const payments = new PaystackPayments({
        paystack,
        store: emulator.store,
        outbox: emulator.outbox,
        clock: () => emulator.store.clock(),
        timer: NO_TIMER,
      })
      const { transaction } = payments.start({
        integration,
        email: customer.email,
        amount,
        currency: "NGN",
        metadata: { receiver_account_number: accountNumber },
        callbackUrl: null,
        channels: ["dedicated_nuban"],
        plan: null,
      })
      const paid = payments.succeed(transaction.reference, {
        channel: "dedicated_nuban",
        authorization: channelAuthorization("dedicated_nuban", account.bank.name),
      })

      return paid ?? transaction
    },
  }
}
