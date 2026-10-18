/**
 * What tests read and do on a Flutterwave emulator from outside the app: its books (transactions,
 * refunds, transfers, subscriptions, balances), charging subscriptions that are due, and paying a
 * virtual account the way a customer's bank transfer would.
 */
import type { Emulator } from "../define.ts"
import type { FlutterwaveState } from "./context.ts"
import type { Balance, Refund, Subscription, Transaction, Transfer } from "./entities.ts"
import { FlutterwaveEvents } from "./events.ts"
import { transactionObject } from "./formatters.ts"
import { nextId } from "./helpers.ts"
import { linkCustomer, recordTransaction, renewDue } from "./payments.ts"
import { flutterwaveStore } from "./store.ts"

/** The emulator's state as payments and webhooks need it, outside a request. */
function stateOf(emulator: Pick<Emulator, "store" | "outbox">): FlutterwaveState {
  return {
    flutterwave: flutterwaveStore(emulator.store),
    outbox: emulator.outbox,
    clock: emulator.store.clock,
    store: emulator.store,
  }
}

/** What `flutterwaveLedger(emulator)` reads and does: the merchant's books in the emulator. */
export interface FlutterwaveLedger {
  /** Every transaction, oldest first; successful and failed attempts alike. */
  transactions(): Transaction[]
  /** The successful transactions for `txRef`. */
  paid(txRef: string): Transaction[]
  refunds(): Refund[]
  transfers(): Transfer[]
  subscriptions(): Subscription[]
  /** The balance in `currency`, or undefined when the account has none. */
  balance(currency?: string): Balance | undefined
  /**
   * Charges every subscription whose interval has passed by the emulator's clock, with its webhook;
   * returns how many charges were made. API calls do this too.
   */
  renewDue(): number
}

/** The books of a Flutterwave emulator. */
export function flutterwaveLedger(emulator: Pick<Emulator, "store" | "outbox">): FlutterwaveLedger {
  const state = stateOf(emulator)
  const { flutterwave } = state

  return {
    transactions: () => flutterwave.transactions.all(),
    paid: (txRef) =>
      flutterwave.transactions.where((tx) => tx.tx_ref === txRef && tx.status === "successful"),
    refunds: () => flutterwave.refunds.all(),
    transfers: () => flutterwave.transfers.all(),
    subscriptions: () => flutterwave.subscriptions.all(),
    balance: (currency = "NGN") => flutterwave.balances.get(currency.toUpperCase()),
    renewDue: () => renewDue(state, new FlutterwaveEvents(state)),
  }
}

/** What `flutterwaveBank(emulator)` does: money arriving at virtual accounts. */
export interface FlutterwaveBank {
  /**
   * A bank transfer into the virtual account `accountNumber`, as the customer's bank makes it: a
   * successful `bank_transfer` transaction under the account's `tx_ref`, with `charge.completed`.
   */
  transferIn(transfer: { readonly accountNumber: string; readonly amount: number }): Transaction
}

/** Money arriving at a Flutterwave emulator's virtual accounts. */
export function flutterwaveBank(emulator: Pick<Emulator, "store" | "outbox">): FlutterwaveBank {
  const state = stateOf(emulator)

  return {
    transferIn({ accountNumber, amount }) {
      const { virtualAccounts } = state.flutterwave
      const account = virtualAccounts.where(
        (candidate) => candidate.account_number === accountNumber,
      )[0]
      const extra = account && virtualAccounts.extra(account.order_ref)

      if (account === undefined || extra === undefined)
        throw new Error(`no virtual account ${accountNumber}`)

      const now = state.clock()

      return recordTransaction(
        state,
        new FlutterwaveEvents(state),
        transactionObject({
          id: nextId(state.store),
          txRef: extra.txRef,
          amount,
          currency: "NGN",
          status: "successful",
          processorResponse: "success",
          paymentType: "bank_transfer",
          authModel: "AUTH",
          customer: linkCustomer(
            { customer: { email: extra.email, name: extra.name, phone_number: null } },
            now,
          ),
          meta: { originatoraccountnumber: "123*******90", bankname: "Access Bank" },
          now,
        }),
      )
    },
  }
}
