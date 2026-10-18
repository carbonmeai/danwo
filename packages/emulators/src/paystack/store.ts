import { ObjectTable, objectTable } from "../objects.ts"
import type { Store } from "../store.ts"
import type {
  Authorization,
  Bank,
  Customer,
  DedicatedAccount,
  Integration,
  IntegrationExtra,
  KnownAccount,
  Plan,
  Recipient,
  Refund,
  Subscription,
  Transaction,
  TransactionExtra,
  Transfer,
} from "./entities.ts"

/** A table keyed by one of the object's own fields instead of an `id`. */
function keyedTable<T extends object, X = null>(
  store: Store,
  name: string,
  keyOf: (object: T) => string,
): ObjectTable<T, X> {
  return new ObjectTable(store.collection(name, ["key"]), keyOf)
}

/** The Paystack objects held in an emulator's store, each addressed the way the API addresses it. */
export function paystackStore(store: Store) {
  return {
    integrations: objectTable<Integration, IntegrationExtra>(store, "paystack.integrations"),
    transactions: keyedTable<Transaction, TransactionExtra>(
      store,
      "paystack.transactions",
      (t) => t.reference,
    ),
    customers: keyedTable<Customer>(store, "paystack.customers", (c) => c.customer_code),
    authorizations: keyedTable<Authorization, { readonly customer: string }>(
      store,
      "paystack.authorizations",
      (a) => a.authorization_code,
    ),
    plans: keyedTable<Plan>(store, "paystack.plans", (p) => p.plan_code),
    subscriptions: keyedTable<Subscription>(
      store,
      "paystack.subscriptions",
      (s) => s.subscription_code,
    ),
    recipients: keyedTable<Recipient>(store, "paystack.recipients", (r) => r.recipient_code),
    transfers: keyedTable<Transfer>(store, "paystack.transfers", (t) => t.transfer_code),
    refunds: keyedTable<Refund>(store, "paystack.refunds", (r) => String(r.id)),
    banks: keyedTable<Bank>(store, "paystack.banks", (b) => b.code),
    accounts: objectTable<KnownAccount>(store, "paystack.known_accounts"),
    dedicated: keyedTable<DedicatedAccount>(store, "paystack.dedicated", (d) => d.account_number),
  }
}

export type PaystackStore = ReturnType<typeof paystackStore>
