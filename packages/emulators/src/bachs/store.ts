import { objectTable } from "../objects.ts"
import type { DataKey, Store } from "../store.ts"
import type {
  BalanceRow,
  CheckoutSession,
  Customer,
  Invoice,
  Payment,
  Payout,
  PayoutDestination,
  PayoutQuote,
  PortalSession,
  Product,
  RecoveryEmail,
  Refund,
  SavedCard,
  Subscription,
  VirtualAccount,
  WebhookEndpointRecord,
} from "./entities.ts"

/** The account the emulator answers as; events carry it as `organization_id`. */
const ORGANIZATION: DataKey<string> = { name: "bachs.organization" }

const DEFAULT_ORGANIZATION = "acct_danwoSandbox01"

/** What happens to a subscription when payment recovery runs out: cancel it (the default) or mark it unpaid. */
export type RecoveryOutcome = "cancel" | "mark_unpaid"

const RECOVERY: DataKey<RecoveryOutcome> = { name: "bachs.recovery" }

/** The Bachs objects held in an emulator's store, addressed by their ids. */
export function bachsStore(store: Store) {
  return {
    products: objectTable<Product>(store, "bachs.products"),
    customers: objectTable<Customer>(store, "bachs.customers"),
    checkouts: objectTable<CheckoutSession>(store, "bachs.checkouts"),
    payments: objectTable<Payment>(store, "bachs.payments"),
    refunds: objectTable<Refund>(store, "bachs.refunds"),
    subscriptions: objectTable<Subscription>(store, "bachs.subscriptions"),
    invoices: objectTable<Invoice>(store, "bachs.invoices"),
    cards: objectTable<SavedCard>(store, "bachs.cards"),
    portalSessions: objectTable<PortalSession>(store, "bachs.portal_sessions"),
    recoveryEmails: objectTable<RecoveryEmail>(store, "bachs.recovery_emails"),
    destinations: objectTable<PayoutDestination>(store, "bachs.payout_destinations"),
    quotes: objectTable<PayoutQuote>(store, "bachs.payout_quotes"),
    payouts: objectTable<Payout>(store, "bachs.payouts"),
    virtualAccounts: objectTable<VirtualAccount>(store, "bachs.virtual_accounts"),
    endpoints: objectTable<WebhookEndpointRecord>(store, "bachs.webhook_endpoints"),
    balances: objectTable<BalanceRow>(store, "bachs.balances"),
    organization: () => store.getData(ORGANIZATION) ?? DEFAULT_ORGANIZATION,
    setOrganization: (id: string) => store.setData(ORGANIZATION, id),
    recovery: (): RecoveryOutcome => store.getData(RECOVERY) ?? "cancel",
    setRecovery: (outcome: RecoveryOutcome) => store.setData(RECOVERY, outcome),
  }
}

export type BachsStore = ReturnType<typeof bachsStore>
