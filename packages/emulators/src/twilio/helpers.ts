import { randomBytes, randomInt } from "node:crypto"

import type { Context } from "../http.ts"

/** The hosts the Twilio emulator answers: the REST API and Verify. */
export const TWILIO_HOSTS = ["api.twilio.com", "verify.twilio.com"]

export const VERIFY_BASE = "https://verify.twilio.com"
export const API_VERSION = "2010-04-01"

/** A Twilio SID: two letters naming the kind (`SM` message, `VA` service, `VE` verification) and 32 hex digits. */
export function twilioSid(prefix: string): string {
  return prefix + randomBytes(16).toString("hex")
}

/** A one-time code of `length` digits. */
export function oneTimeCode(length: number): string {
  return Array.from({ length }, () => String(randomInt(10))).join("")
}

/** Twilio's error body, as every API answers a failure. */
export interface TwilioErrorBody {
  readonly code: number
  readonly message: string
  readonly more_info: string
  readonly status: number
}

export function errorBody(status: number, code: number, message: string): TwilioErrorBody {
  return { code, message, more_info: `https://www.twilio.com/docs/errors/${code}`, status }
}

export function twilioError(c: Context, status: number, code: number, message: string): Response {
  return c.json(errorBody(status, code, message), status)
}

export function notFound(c: Context, what: string): Response {
  return twilioError(c, 404, 20404, `The requested resource ${what} was not found`)
}

/** A date as the 2010 API writes it (RFC 2822), e.g. `Sun, 18 Oct 2026 08:00:00 +0000`. */
export function rfc2822(date: Date): string {
  return date.toUTCString().replace("GMT", "+0000")
}

/** A date as the Verify API writes it (ISO 8601, to the second). */
export function iso(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, "Z")
}

/** Whether `value` is a phone number in E.164: a plus and up to 15 digits. */
export function isE164(value: string): boolean {
  return /^\+[1-9]\d{6,14}$/.test(value)
}

/** The form fields a request sent; a field given more than once keeps every value. */
export async function formOf(c: Context): Promise<URLSearchParams> {
  return new URLSearchParams(await c.req.text())
}

/** A whole-number query value within limits, or `fallback`. */
function boundedInt(value: string | undefined, fallback: number, max: number): number {
  const parsed = Number(value)

  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, max) : fallback
}

/**
 * One page of `all` in the 2010 API's paging shape, read from the request's `PageSize` and `Page`:
 * the items under `field`, with the page's position and the URIs of the first, previous and next
 * pages of `path` (a list's `.json` path under the account).
 */
export function legacyPage<T>(
  c: Context,
  all: readonly T[],
  path: string,
  field: string,
  item: (value: T) => unknown = (value) => value,
): Response {
  const size = boundedInt(c.req.query("PageSize"), 50, 1000)
  const page = Number(c.req.query("Page") ?? 0) || 0
  const start = page * size
  const items = all.slice(start, start + size)
  const uriFor = (n: number) => `${path}?PageSize=${size}&Page=${n}`

  return c.json({
    [field]: items.map(item),
    start,
    end: start + Math.max(0, items.length - 1),
    page,
    page_size: size,
    uri: uriFor(page),
    first_page_uri: uriFor(0),
    previous_page_uri: page > 0 ? uriFor(page - 1) : null,
    next_page_uri: start + size < all.length ? uriFor(page + 1) : null,
  })
}
