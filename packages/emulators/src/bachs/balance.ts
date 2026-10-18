import { BachsFailure, money } from "./helpers.ts"
import type { BachsStore } from "./store.ts"

/** How many US dollars one unit of a currency buys, for converted payouts and the USD total. */
const USD_PER_UNIT: Readonly<Record<string, number>> = {
  USD: 1,
  NGN: 1 / 1500,
  GHS: 1 / 15,
  KES: 1 / 130,
  GBP: 1.25,
  EUR: 1.08,
  CAD: 0.73,
}

/** The USD value of one unit of `currency`; 0 for currencies the emulator has no rate for. */
export function usdPerUnit(currency: string): number {
  return USD_PER_UNIT[currency] ?? 0
}

/** The rate converting `from` into `to`, or undefined when either has no rate. */
export function exchangeRate(from: string, to: string): number | undefined {
  const fromUsd = USD_PER_UNIT[from]
  const toUsd = USD_PER_UNIT[to]

  return fromUsd === undefined || toUsd === undefined ? undefined : fromUsd / toUsd
}

/** The account's balance row for `currency`, created empty on first use. */
function rowOf(bachs: BachsStore, currency: string) {
  return (
    bachs.balances.get(currency) ??
    bachs.balances.add({ id: currency, currency, available: 0, pending: 0 }, null)
  )
}

/** Adds `amount` (minor units, may be negative) to what is available in `currency`. */
export function credit(bachs: BachsStore, currency: string, amount: number): void {
  const row = rowOf(bachs, currency)

  bachs.balances.change(currency, { available: row.available + amount })
}

/** Takes `amount` out of what is available in `currency`, refusing when it is not there. */
export function debit(bachs: BachsStore, currency: string, amount: number, what: string): void {
  const row = rowOf(bachs, currency)

  if (row.available < amount)
    throw new BachsFailure(
      400,
      "INSUFFICIENT_BALANCE",
      `Insufficient balance for ${what}: ${money(amount)} ${currency} required, ${money(row.available)} ${currency} available.`,
    )

  bachs.balances.change(currency, { available: row.available - amount })
}
