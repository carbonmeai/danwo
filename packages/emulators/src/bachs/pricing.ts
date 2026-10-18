/** Reading prices and cadences from request bodies, with Bachs's validation errors. */
import { isRecord } from "../json.ts"
import type { Cadence, Price, PriceType } from "./entities.ts"
import { BachsFailure, invalid, minorOf } from "./helpers.ts"

const CURRENCIES = ["USD", "NGN", "GHS", "KES", "MWK", "RWF", "TZS", "UGX", "XAF", "XOF", "ZMW"]
const INTERVALS = ["day", "week", "month", "year"] as const

/** An optional money field in minor units; null when absent, a 400 when malformed. */
function optionalMoney(price: Record<string, unknown>, key: string): number | null {
  const value = price[key]

  if (value === undefined || value === null) return null

  const minor = minorOf(value)

  if (minor === undefined)
    invalid(`price: ${key} must be a decimal string such as "29.00"`, {
      field: `price.${key}`,
      message: "Must be a decimal string",
      type: "value_error",
    })

  return minor
}

function priceTypeOf(value: unknown): PriceType {
  if (value === undefined || value === null || value === "fixed") return "fixed"
  if (value === "free" || value === "custom") return value

  return invalid(`price: price_type must be fixed, free or custom`, {
    field: "price.price_type",
    message: "Invalid price type",
    type: "enum",
  })
}

/** A custom price's bounds must hold its preset. */
function checkCustom(preset: number | null, minimum: number | null, maximum: number | null): void {
  if (minimum !== null && maximum !== null && minimum > maximum)
    invalid("price: minimum_amount must not exceed maximum_amount")
  if (
    preset !== null &&
    ((minimum !== null && preset < minimum) || (maximum !== null && preset > maximum))
  )
    invalid("price: preset_amount must fall within minimum_amount and maximum_amount")
}

/** A product's or checkout's price, from its request object. `currency` is the fallback for an override. */
export function priceOf(value: unknown, fallbackCurrency?: string): Price {
  if (!isRecord(value))
    invalid("price is required", { field: "price", message: "Field required", type: "missing" })

  const currency =
    typeof value["currency"] === "string" ? value["currency"].toUpperCase() : fallbackCurrency

  if (!currency)
    invalid("price: currency is required", {
      field: "price.currency",
      message: "Field required",
      type: "missing",
    })
  if (!CURRENCIES.includes(currency))
    throw new BachsFailure(422, "CURRENCY_NOT_SUPPORTED", `Currency ${currency} is not supported`)

  const type = priceTypeOf(value["price_type"])
  const amount = optionalMoney(value, "amount")
  const preset = optionalMoney(value, "preset_amount")
  const minimum = optionalMoney(value, "minimum_amount")
  const maximum = optionalMoney(value, "maximum_amount")

  if (type === "fixed" && amount === null) invalid("price: amount is required for a fixed price.")
  if (type === "custom") checkCustom(preset, minimum, maximum)

  return { currency, type, amount: type === "fixed" ? amount : null, preset, minimum, maximum }
}

/** A cadence (`billing_cycle`, `trial_period`), or null when absent. */
export function cadenceOf(value: unknown, field: string): Cadence | null {
  if (value === undefined || value === null) return null
  if (!isRecord(value)) invalid(`${field} must be an object`)

  const interval = INTERVALS.find((item) => item === value["interval"])
  const frequency = value["frequency"]

  if (!interval)
    throw new BachsFailure(
      400,
      "INVALID_INTERVAL",
      `${field}.interval must be day, week, month or year`,
    )
  if (typeof frequency !== "number" || !Number.isInteger(frequency) || frequency < 1)
    throw new BachsFailure(
      400,
      "INTERVAL_REQUIRED",
      `${field}.frequency must be a positive integer`,
    )

  return { interval, frequency }
}
