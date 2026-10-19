import { randomInt } from "node:crypto"

import type { Context } from "../http.ts"
import { asRecord } from "../json.ts"
import type { DataKey, Store } from "../store.ts"
import { type Problem, problemFor } from "./problems.ts"

/** The hosts the Paystack emulator answers: the REST API and the hosted payment page. */
export const PAYSTACK_HOSTS = ["api.paystack.co", "checkout.paystack.com"]

export const CHECKOUT_BASE = "https://checkout.paystack.com"

/** The currencies an integration can charge in; amounts are always in the currency's subunit. */
const CURRENCIES = ["NGN", "GHS", "ZAR", "KES", "USD"] as const

export type Currency = (typeof CURRENCIES)[number]

const LOWER = "abcdefghijklmnopqrstuvwxyz0123456789"
const MIXED = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"

/** `length` random characters from `alphabet`. */
function randomFrom(alphabet: string, length: number): string {
  return Array.from({ length }, () => alphabet[randomInt(alphabet.length)] ?? "").join("")
}

/** A Paystack code: a kind prefix (`CUS`, `PLN`, `SUB`, `TRF`, `RCP`, `AUTH`) and random characters. */
export function paystackCode(prefix: string, length = 15): string {
  return `${prefix}_${randomFrom(LOWER, length)}`
}

/**
 * A transaction reference in Paystack's style, when the caller gives none: letters and digits, with
 * digits always among them, as Paystack's are (and as danwo's matrix recognises a generated id).
 */
export function newReference(): string {
  return `${randomFrom(MIXED, 12)}${randomFrom("0123456789", 4)}`
}

/** The code in a hosted payment page's address. */
export function newAccessCode(): string {
  return randomFrom(LOWER, 15)
}

/** A one-time token, such as a subscription's email token. */
export function newToken(): string {
  return randomFrom(LOWER, 20)
}

/** A NUBAN-style ten-digit account number. */
export function accountNumber(): string {
  return `9${randomFrom("0123456789", 9)}`
}

const LAST_ID: DataKey<number> = { name: "paystack.last_id" }

/** The next numeric id: every Paystack object takes one from a shared, increasing sequence. */
export function nextId(store: Store): number {
  const id = (store.getData(LAST_ID) ?? 1_000_000) + 1

  store.setData(LAST_ID, id)

  return id
}

/** Paying-out paging: `page` and `perPage` as Paystack's `meta` reports them. */
export interface PageMeta {
  readonly total: number
  readonly skipped: number
  readonly perPage: number
  readonly page: number
  readonly pageCount: number
}

/** One page of `items` with its `meta`, newest first as Paystack lists them. */
export function pageOf<T>(c: Context, items: readonly T[]): { data: T[]; meta: PageMeta } {
  const perPage = Math.min(Math.max(Number(c.req.query("perPage")) || 50, 1), 100)
  const page = Math.max(Number(c.req.query("page")) || 1, 1)
  const skipped = (page - 1) * perPage
  const newest = items.toReversed()

  return {
    data: newest.slice(skipped, skipped + perPage),
    meta: {
      total: items.length,
      skipped,
      perPage,
      page,
      pageCount: Math.max(Math.ceil(items.length / perPage), 1),
    },
  }
}

/** A successful answer in Paystack's envelope. */
export function ok(c: Context, message: string, data: unknown, extra: object = {}): Response {
  return c.json({ status: true, message, data, ...extra })
}

/**
 * A failed answer in Paystack's envelope: `status: false`, the message, and the problem's `code`
 * with its `meta.nextStep`. Refused requests are a `validation_error`; Paystack's own failures an
 * `api_error`.
 */
export function fail(
  c: Context,
  status: number,
  message: string,
  problem: Problem = problemFor(status),
): Response {
  return c.json(
    {
      status: false,
      message,
      meta: { nextStep: problem.nextStep },
      type: status >= 500 ? "api_error" : "validation_error",
      code: problem.code,
    },
    status,
  )
}

/** A JSON or form body as a record of fields; anything else gives an empty record. */
export async function bodyOf(c: Context): Promise<Record<string, unknown>> {
  const type = c.req.header("content-type") ?? ""

  if (/x-www-form-urlencoded|multipart/i.test(type)) return c.req.parseBody()

  const raw = await c.req.text()

  if (raw.trim() === "") return {}

  try {
    return asRecord(JSON.parse(raw)) ?? {}
  } catch {
    return {}
  }
}

/** A string field, trimmed; undefined when absent or empty. */
export function text(fields: Record<string, unknown>, name: string): string | undefined {
  const value = fields[name]

  if (typeof value !== "string" && typeof value !== "number") return undefined

  const trimmed = String(value).trim()

  return trimmed === "" ? undefined : trimmed
}

/** A whole, positive amount in the subunit, given as a number or a numeric string. */
export function amountOf(fields: Record<string, unknown>, name = "amount"): number | undefined {
  const raw = text(fields, name)
  const value = Number(raw)

  return raw !== undefined && Number.isInteger(value) && value > 0 ? value : undefined
}

/** The currency of a request, or the integration's default. */
export function currencyOf(
  fields: Record<string, unknown>,
  fallback: Currency,
): Currency | undefined {
  const given = text(fields, "currency")?.toUpperCase() ?? fallback

  return CURRENCIES.find((currency) => currency === given)
}

/** `value` when it is a plain JSON object; metadata sent as a JSON string is parsed. */
export function metadataOf(value: unknown): Record<string, unknown> {
  if (typeof value !== "string") return asRecord(value) ?? {}

  try {
    return asRecord(JSON.parse(value)) ?? {}
  } catch {
    return {}
  }
}

/** `amount` in `currency` written for people, e.g. `₦5,000.00`. */
export function formatAmount(amount: number, currency: string): string {
  const symbols: Readonly<Record<string, string>> = {
    NGN: "₦",
    GHS: "GH₵",
    ZAR: "R",
    KES: "KSh",
    USD: "$",
  }
  const major = (amount / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })

  return `${symbols[currency] ?? `${currency} `}${major}`
}
