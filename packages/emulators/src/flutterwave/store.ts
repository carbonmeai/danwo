import { ObjectTable, type ObjectRow, objectTable } from "../objects.ts"
import type { Store } from "../store.ts"
import type {
  Balance,
  Beneficiary,
  KnownAccount,
  LinkExtra,
  PaymentLink,
  PaymentPlan,
  Refund,
  SeededBank,
  Subscription,
  SubscriptionExtra,
  Transaction,
  TransactionExtra,
  Transfer,
  TransferExtra,
  VirtualAccount,
  VirtualAccountExtra,
} from "./entities.ts"

/** The table of `name` objects in `store`, for objects whose ids are numbers. */
function numberTable<T extends { id: number }, X = null>(
  store: Store,
  name: string,
): ObjectTable<T, X> {
  return new ObjectTable(store.collection<ObjectRow<T, X>>(name, ["key"]), (object) =>
    String(object.id),
  )
}

/** Virtual accounts, addressed by their order reference. */
function orderTable(store: Store) {
  return new ObjectTable<VirtualAccount, VirtualAccountExtra>(
    store.collection<ObjectRow<VirtualAccount, VirtualAccountExtra>>(
      "flutterwave.virtual_accounts",
      ["key"],
    ),
    (account) => account.order_ref,
  )
}

/** The Flutterwave objects held in an emulator's store. */
export function flutterwaveStore(store: Store) {
  return {
    links: objectTable<PaymentLink, LinkExtra>(store, "flutterwave.links"),
    transactions: numberTable<Transaction, TransactionExtra>(store, "flutterwave.transactions"),
    refunds: numberTable<Refund>(store, "flutterwave.refunds"),
    plans: numberTable<PaymentPlan>(store, "flutterwave.plans"),
    subscriptions: numberTable<Subscription, SubscriptionExtra>(store, "flutterwave.subscriptions"),
    transfers: numberTable<Transfer, TransferExtra>(store, "flutterwave.transfers"),
    beneficiaries: numberTable<Beneficiary>(store, "flutterwave.beneficiaries"),
    virtualAccounts: orderTable(store),
    banks: objectTable<SeededBank>(store, "flutterwave.banks"),
    accounts: objectTable<KnownAccount>(store, "flutterwave.accounts"),
    balances: objectTable<Balance>(store, "flutterwave.balances"),
  }
}

export type FlutterwaveStore = ReturnType<typeof flutterwaveStore>
