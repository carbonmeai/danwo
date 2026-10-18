import { randomBytes } from "node:crypto"

import { HttpError } from "../errors.ts"
import type { Context } from "../http.ts"
import { isRecord } from "../json.ts"
import type { DataKey, Store } from "../store.ts"

/** Flutterwave's API and its hosted checkout. */
export const FLUTTERWAVE_HOSTS = ["api.flutterwave.com", "checkout.flutterwave.com"]

/** Where hosted payment links point. */
export const CHECKOUT_BASE = "https://checkout.flutterwave.com"

/** The merchant account every object belongs to. */
export const ACCOUNT_ID = 73_362

/** The last id handed out; ids are shared by every kind of object, as numbers. */
const LAST_ID: DataKey<number> = { name: "flutterwave.last_id" }

/** The next numeric id. */
export function nextId(store: Store): number {
  const next = (store.getData(LAST_ID) ?? 1_000_000) + 1

  store.setData(LAST_ID, next)

  return next
}

/** Random hex of `bytes` bytes, for references Flutterwave makes up. */
export function hex(bytes: number): string {
  return randomBytes(bytes).toString("hex")
}

/** An ISO 8601 time with milliseconds, as Flutterwave writes them. */
export function isoTime(date: Date): string {
  return date.toISOString()
}

/** `2026-10-18 08:00:00`, as virtual accounts write their times. */
export function plainTime(date: Date): string {
  return date.toISOString().replace("T", " ").slice(0, 19)
}

/** A sum rounded to two decimals. */
export function money(value: number): number {
  return Math.round(value * 100) / 100
}

/** What Flutterwave keeps of a local payment: 1.4% (the emulator charges every currency the same). */
export function appFee(amount: number): number {
  return money(amount * 0.014)
}

/** What a transfer costs, by currency. */
export function transferFee(currency: string): number {
  return currency === "NGN" ? 26.875 : 1
}

/** A successful answer in Flutterwave's envelope. */
export function success(c: Context, message: string, data: unknown, meta?: unknown): Response {
  return c.json({ status: "success", message, data, ...(meta !== undefined && { meta }) })
}

/** An error answer in Flutterwave's envelope. */
export function failure(c: Context, status: number, message: string): Response {
  return c.json({ status: "error", message, data: null }, status)
}

/** Flutterwave's answer to a server error: its own shape, not the envelope. */
export function serverError(c: Context): Response {
  return c.json(
    {
      error_id: `ERRNO${hex(5).toUpperCase()}`,
      message: "Application error. Please contact support",
      code: "app_error",
    },
    500,
  )
}

/** The JSON object a request sent, or a 400 when it sent something else. */
export async function jsonBody(c: Context): Promise<Record<string, unknown>> {
  const raw = await c.req.text()

  if (raw.trim() === "") return {}

  try {
    const value: unknown = JSON.parse(raw)

    if (isRecord(value)) return value
  } catch {
    /* falls through to the 400 below */
  }

  throw new HttpError(400, "Invalid JSON payload")
}

/** A field as a string, or undefined when it is missing or not a string or number. */
export function text(body: Record<string, unknown>, field: string): string | undefined {
  const value = body[field]

  if (typeof value === "string") return value
  if (typeof value === "number") return String(value)

  return undefined
}

/** A field as a number, from a number or a numeric string. */
export function amountOf(body: Record<string, unknown>, field: string): number | undefined {
  const value = body[field]
  const parsed = typeof value === "string" && value.trim() !== "" ? Number(value) : value

  return typeof parsed === "number" && Number.isFinite(parsed) ? parsed : undefined
}

/** A field as an object, or null. */
export function objectField(
  body: Record<string, unknown>,
  field: string,
): Record<string, unknown> | null {
  const value = body[field]

  return isRecord(value) ? value : null
}

/** A required string field, or a 400 saying it is required. */
export function required(body: Record<string, unknown>, field: string): string {
  const value = text(body, field)

  if (value === undefined || value === "") throw new HttpError(400, `${field} is required`)

  return value
}

/** Paging meta as list endpoints return it. */
function pageInfo(total: number, page: number, size: number) {
  return {
    page_info: {
      total,
      current_page: page,
      total_pages: Math.max(1, Math.ceil(total / size)),
    },
  }
}

/** One page of `items`, 1-based, from the `page` query. */
export function pageOf<T>(
  c: Context,
  items: readonly T[],
  size = 10,
): { data: T[]; meta: unknown } {
  const page = Math.max(1, Number(c.req.query("page") ?? "1") || 1)

  return {
    data: items.slice((page - 1) * size, page * size),
    meta: pageInfo(items.length, page, size),
  }
}
