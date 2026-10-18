import type { Store } from "../store.ts"
import type { PlanInterval } from "./entities.ts"
import { setWebhook } from "./events.ts"
import { isoTime } from "./helpers.ts"
import { flutterwaveStore } from "./store.ts"

/** An account `POST /v3/accounts/resolve` names, and transfers can pay. */
export interface FlutterwaveSeedAccount {
  readonly bankCode: string
  readonly accountNumber: string
  readonly accountName: string
  /** Transfers to it are refused as Flutterwave refuses blacklisted accounts. */
  readonly blacklisted?: boolean
}

/** A payment plan to start with, under a fixed id so a test can pay for it by number. */
export interface FlutterwaveSeedPlan {
  readonly id: number
  readonly name: string
  readonly amount: number
  readonly interval: PlanInterval
  readonly currency?: string
  readonly duration?: number
}

/** Data to load into a Flutterwave emulator. */
export type FlutterwaveSeedConfig = Partial<{
  /** The dashboard's webhook: its URL and the secret hash every delivery carries. */
  readonly webhook: { readonly url: string; readonly secretHash: string }
  /** Balances by currency, major units; NGN 1,000,000 when none are given. */
  readonly balances: Readonly<Record<string, number>>
  /** Accounts besides Flutterwave's test accounts (Access Bank, 0690000031 to 0690000041). */
  readonly accounts: readonly FlutterwaveSeedAccount[]
  readonly plans: readonly FlutterwaveSeedPlan[]
}>

/** Banks `GET /v3/banks/:country` lists, by country. */
const BANKS: Readonly<Record<string, readonly (readonly [number, string, string])[]>> = {
  NG: [
    [191, "044", "Access Bank"],
    [192, "058", "Guaranty Trust Bank"],
    [193, "011", "First Bank of Nigeria"],
    [194, "057", "Zenith Bank"],
    [195, "033", "United Bank for Africa"],
    [196, "090267", "Kuda Microfinance Bank"],
  ],
  GH: [
    [301, "GH280100", "Access Bank Ghana"],
    [302, "GH230100", "GCB Bank"],
  ],
  KE: [
    [401, "68", "Equity Bank"],
    [402, "01", "Kenya Commercial Bank"],
  ],
}

/** Flutterwave's test accounts at Access Bank; 0690000036 is the blacklisted one. */
function testAccounts(): FlutterwaveSeedAccount[] {
  const names = ["Forrest Green", "Pastor Bright", "Bale Gary", "Ade Tester", "Kemi Tester"]

  return Array.from({ length: 11 }, (_, index) => {
    const accountNumber = `06900000${31 + index}`

    return {
      bankCode: "044",
      accountNumber,
      accountName:
        accountNumber === "0690000036" ? "Bode George" : (names[index % names.length] ?? "Test"),
      blacklisted: accountNumber === "0690000036",
    }
  })
}

type Seeding = ReturnType<typeof flutterwaveStore>

function seedBanks(flutterwave: Seeding): void {
  for (const [country, banks] of Object.entries(BANKS))
    for (const [id, code, name] of banks)
      if (!flutterwave.banks.get(`${country}:${code}`))
        flutterwave.banks.add({ id: `${country}:${code}`, country, bank: { id, code, name } }, null)
}

function seedAccounts(flutterwave: Seeding, accounts: readonly FlutterwaveSeedAccount[]): void {
  for (const account of [...testAccounts(), ...accounts]) {
    const id = `${account.bankCode}:${account.accountNumber}`

    flutterwave.accounts.remove(id)
    flutterwave.accounts.add({ id, ...account, blacklisted: account.blacklisted ?? false }, null)
  }
}

function seedBalances(flutterwave: Seeding, balances: Readonly<Record<string, number>>): void {
  for (const [currency, amount] of Object.entries(balances)) {
    flutterwave.balances.remove(currency)
    flutterwave.balances.add(
      { id: currency, currency, available_balance: amount, ledger_balance: amount },
      null,
    )
  }
}

function seedPlans(
  store: Store,
  flutterwave: Seeding,
  plans: readonly FlutterwaveSeedPlan[],
): void {
  for (const plan of plans) {
    if (flutterwave.plans.get(String(plan.id))) continue

    flutterwave.plans.add(
      {
        id: plan.id,
        name: plan.name,
        amount: plan.amount,
        interval: plan.interval,
        duration: plan.duration ?? 0,
        status: "active",
        currency: plan.currency ?? "NGN",
        plan_token: `rpp_seed${plan.id}`,
        created_at: isoTime(store.clock()),
      },
      null,
    )
  }
}

/** Loads `config` into the Flutterwave emulator's store; banks and test accounts always come along. */
export function seedFlutterwave(store: Store, config: FlutterwaveSeedConfig = {}): void {
  const flutterwave = flutterwaveStore(store)

  seedBanks(flutterwave)
  seedAccounts(flutterwave, config.accounts ?? [])
  seedBalances(flutterwave, config.balances ?? { NGN: 1_000_000 })
  seedPlans(store, flutterwave, config.plans ?? [])

  if (config.webhook) setWebhook(store, config.webhook)
}
