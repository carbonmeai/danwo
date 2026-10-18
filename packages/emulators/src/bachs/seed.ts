import type { Store } from "../store.ts"
import { credit } from "./balance.ts"
import type { Cadence } from "./entities.ts"
import { bachsId, hex, minorOf } from "./helpers.ts"
import { cadenceOf, priceOf } from "./pricing.ts"
import { bachsStore, type BachsStore, type RecoveryOutcome } from "./store.ts"

/** A product to seed; its price is written as the API takes it (`{ currency, amount, price_type }`). */
export interface BachsSeedProduct {
  readonly id?: string
  readonly name: string
  readonly description?: string
  readonly price: Readonly<Record<string, unknown>>
  readonly billing_cycle?: Cadence
  readonly trial_period?: Cadence
  readonly metadata?: Record<string, unknown>
}

export interface BachsSeedCustomer {
  readonly id?: string
  readonly email: string
  readonly name?: string
}

/** A webhook endpoint; without a `secret`, a random one. `events` may include `"*"`. */
export interface BachsSeedEndpoint {
  readonly url: string
  readonly events: readonly string[]
  readonly secret?: string
}

/** A payout destination; `fails` makes payouts to it fail once sent. */
export interface BachsSeedDestination {
  readonly id?: string
  readonly currency: string
  readonly type?: string
  readonly account_number?: string
  readonly bank_code?: string
  readonly fails?: boolean
}

/** Data to load into a Bachs emulator. Balances are decimal strings by currency, e.g. `{ USD: "500.00" }`. */
export interface BachsSeedConfig {
  readonly organization?: string
  readonly products?: readonly BachsSeedProduct[]
  readonly customers?: readonly BachsSeedCustomer[]
  readonly webhookEndpoints?: readonly BachsSeedEndpoint[]
  readonly balances?: Readonly<Record<string, string>>
  readonly destinations?: readonly BachsSeedDestination[]
  /** What happens when payment recovery runs out; `cancel` by default. */
  readonly recovery?: RecoveryOutcome
}

function seedProducts(bachs: BachsStore, now: string, products: readonly BachsSeedProduct[]): void {
  for (const product of products)
    bachs.products.add(
      {
        id: product.id ?? bachsId("prod", 20),
        name: product.name,
        description: product.description ?? null,
        price: priceOf(product.price),
        billingCycle: cadenceOf(product.billing_cycle, "billing_cycle"),
        trialPeriod: cadenceOf(product.trial_period, "trial_period"),
        metadata: product.metadata ?? null,
        archivedAt: null,
        createdAt: now,
        updatedAt: now,
      },
      null,
    )
}

function seedCustomers(
  bachs: BachsStore,
  now: string,
  customers: readonly BachsSeedCustomer[],
): void {
  for (const customer of customers)
    bachs.customers.add(
      {
        id: customer.id ?? bachsId("cust", 12),
        email: customer.email,
        name: customer.name ?? null,
        phoneNumber: null,
        metadata: {},
        billingAddress: null,
        credit: {},
        createdAt: now,
        updatedAt: now,
      },
      null,
    )
}

function seedEndpoints(
  bachs: BachsStore,
  now: string,
  endpoints: readonly BachsSeedEndpoint[],
): void {
  for (const endpoint of endpoints)
    bachs.endpoints.add(
      {
        id: `whe_${hex(16)}`,
        name: null,
        url: endpoint.url,
        enabled: true,
        eventTypes: endpoint.events,
        secret: endpoint.secret ?? `whsec_${hex(24)}`,
        createdAt: now,
        updatedAt: now,
      },
      null,
    )
}

function seedDestinations(
  bachs: BachsStore,
  now: string,
  destinations: readonly BachsSeedDestination[],
): void {
  for (const destination of destinations)
    bachs.destinations.add(
      {
        id: destination.id ?? bachsId("pd", 14),
        name: `${destination.currency} account`,
        type: destination.type ?? "bank_account",
        currency: destination.currency,
        status: "approved",
        accountNumber: destination.account_number ?? "0123456789",
        accountName: "DANWO TEST ACCOUNT",
        bankCode: destination.bank_code ?? "058",
        bankName: null,
        phoneNumber: null,
        mobileProvider: null,
        walletAddress: null,
        network: null,
        fails: destination.fails ?? false,
        createdAt: now,
        updatedAt: now,
      },
      null,
    )
}

/** Loads `config` into a Bachs emulator's store. No events are sent for seeded data. */
export function seedBachs(store: Store, config: BachsSeedConfig): void {
  const bachs = bachsStore(store)
  const now = store.clock().toISOString()

  if (config.organization) bachs.setOrganization(config.organization)
  if (config.recovery) bachs.setRecovery(config.recovery)
  seedProducts(bachs, now, config.products ?? [])
  seedCustomers(bachs, now, config.customers ?? [])
  seedEndpoints(bachs, now, config.webhookEndpoints ?? [])
  seedDestinations(bachs, now, config.destinations ?? [])
  for (const [currency, amount] of Object.entries(config.balances ?? {}))
    credit(bachs, currency, minorOf(amount) ?? 0)
}
