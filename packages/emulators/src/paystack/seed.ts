import type { Store } from "../store.ts"
import type { Bank, Integration, Interval, KnownAccount } from "./entities.ts"
import { customerObject, planObject } from "./formatters.ts"
import { nextId } from "./helpers.ts"
import { type PaystackStore, paystackStore } from "./store.ts"

/** A Paystack business: its keys, where its webhooks go, and its balance for transfers. */
export interface PaystackSeedIntegration {
  /** `sk_test_…`: what the app authenticates with and webhooks are signed with. */
  readonly secretKey: string
  readonly publicKey?: string
  /** Where events are POSTed, signed with the secret key. */
  readonly webhookUrl?: string
  /** Where the hosted page returns the customer when a transaction names no `callback_url`. */
  readonly callbackUrl?: string
  readonly currency?: string
  /** Available balance per currency, in subunits; ₦10,000,000 by default. */
  readonly balance?: Readonly<Record<string, number>>
  /** Transfers wait for `finalize_transfer` with OTP `123456`, as integrations with transfer OTPs on do. */
  readonly transferOtp?: boolean
}

/** A bank account `bank/resolve` knows, and what transfers to it end as. */
export interface PaystackSeedAccount {
  readonly bankCode: string
  readonly accountNumber: string
  readonly accountName: string
  readonly transferOutcome?: KnownAccount["transferOutcome"]
}

export interface PaystackSeedCustomer {
  readonly email: string
  readonly firstName?: string
  readonly lastName?: string
  readonly phone?: string
  /** The integration (by secret key) it belongs to; the first one by default. */
  readonly integration?: string
}

export interface PaystackSeedPlan {
  /** `PLN_…`; one is made up when absent. */
  readonly planCode?: string
  readonly name: string
  readonly amount: number
  readonly interval: Interval
  readonly currency?: string
  readonly invoiceLimit?: number
  readonly integration?: string
}

/** Data to load into a Paystack emulator. */
export type PaystackSeedConfig = Partial<{
  readonly integrations: readonly PaystackSeedIntegration[]
  readonly accounts: readonly PaystackSeedAccount[]
  readonly customers: readonly PaystackSeedCustomer[]
  readonly plans: readonly PaystackSeedPlan[]
}>

/** The banks every emulator lists, with the codes Paystack uses for them. */
const BANKS: ReadonlyArray<readonly [name: string, slug: string, code: string]> = [
  ["Access Bank", "access-bank", "044"],
  ["First Bank of Nigeria", "first-bank-of-nigeria", "011"],
  ["Guaranty Trust Bank", "guaranty-trust-bank", "058"],
  ["Kuda Bank", "kuda-bank", "50211"],
  ["United Bank For Africa", "united-bank-for-africa", "033"],
  ["Wema Bank", "wema-bank", "035"],
  ["Zenith Bank", "zenith-bank", "057"],
  ["Test Bank", "test-bank", "001"],
]

/** When the default banks were added: fixed, so every reset lists them the same. */
const BANKS_ADDED = "2016-07-14T10:04:29.000Z"

/** The default banks, applied with every reset. */
export function seedBanks(store: Store): void {
  const paystack = paystackStore(store)

  BANKS.forEach(([name, slug, code], index) => {
    const bank: Bank = {
      id: index + 1,
      name,
      slug,
      code,
      longcode: code,
      gateway: null,
      pay_with_bank: false,
      supports_transfer: true,
      available_for_direct_debit: false,
      active: true,
      country: "Nigeria",
      currency: "NGN",
      type: "nuban",
      is_deleted: false,
      createdAt: BANKS_ADDED,
      updatedAt: BANKS_ADDED,
    }

    paystack.banks.add(bank, null)
  })
}

function seedIntegration(
  paystack: PaystackStore,
  store: Store,
  given: PaystackSeedIntegration,
): void {
  const integration: Integration = {
    id: given.secretKey,
    number: nextId(store),
    publicKey: given.publicKey ?? given.secretKey.replace(/^sk_/, "pk_"),
    webhookUrl: given.webhookUrl ?? null,
    callbackUrl: given.callbackUrl ?? null,
    currency: given.currency ?? "NGN",
    transferOtp: given.transferOtp ?? false,
  }

  paystack.integrations.add(integration, { balance: given.balance ?? { NGN: 1_000_000_000 } })
}

/** The integration a seed entry names, or the first one. */
function ownerOf(paystack: PaystackStore, secretKey: string | undefined): Integration | undefined {
  return secretKey === undefined
    ? paystack.integrations.all()[0]
    : paystack.integrations.get(secretKey)
}

function seedAccount(paystack: PaystackStore, account: PaystackSeedAccount): void {
  paystack.accounts.add(
    {
      id: `${account.bankCode}:${account.accountNumber}`,
      accountName: account.accountName,
      transferOutcome: account.transferOutcome ?? "success",
    },
    null,
  )
}

function seedCustomer(paystack: PaystackStore, store: Store, customer: PaystackSeedCustomer): void {
  const integration = ownerOf(paystack, customer.integration)

  if (integration)
    paystack.customers.add(
      customerObject({ id: nextId(store), ...customer, integration, now: store.clock() }),
      null,
    )
}

function seedPlan(paystack: PaystackStore, store: Store, plan: PaystackSeedPlan): void {
  const integration = ownerOf(paystack, plan.integration)

  if (integration)
    paystack.plans.add(
      planObject({
        id: nextId(store),
        name: plan.name,
        amount: plan.amount,
        interval: plan.interval,
        currency: plan.currency ?? "NGN",
        description: null,
        invoiceLimit: plan.invoiceLimit ?? 0,
        code: plan.planCode,
        integration,
        now: store.clock(),
      }),
      null,
    )
}

/** Loads integrations, known bank accounts, customers and plans into a Paystack emulator. */
export function seedPaystack(store: Store, config: PaystackSeedConfig): void {
  const paystack = paystackStore(store)

  for (const integration of config.integrations ?? []) seedIntegration(paystack, store, integration)
  for (const account of config.accounts ?? []) seedAccount(paystack, account)
  for (const customer of config.customers ?? []) seedCustomer(paystack, store, customer)
  for (const plan of config.plans ?? []) seedPlan(paystack, store, plan)
}
