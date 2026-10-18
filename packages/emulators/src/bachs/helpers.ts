import { randomBytes } from "node:crypto"

import { HttpError } from "../errors.ts"
import type { Context } from "../http.ts"
import { isRecord } from "../json.ts"

/** The hosts the Bachs emulator answers: the live and sandbox APIs, hosted checkout and the portal. */
export const BACHS_HOSTS = [
  "api.bachs.io",
  "sandbox-api.bachs.io",
  "checkout.bachs.io",
  "portal.bachs.io",
]

export const CHECKOUT_ORIGIN = "https://checkout.bachs.io"
export const PORTAL_ORIGIN = "https://portal.bachs.io"

const ALPHABET = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"

/** A Bachs id: the resource's prefix (`prod`, `cust`, `chk`…), an underscore and random letters and digits. */
export function bachsId(prefix: string, length = 16): string {
  const bytes = randomBytes(length)

  return `${prefix}_${[...bytes].map((byte) => ALPHABET[byte % ALPHABET.length]).join("")}`
}

/** A random lowercase hex string of `bytes` bytes, for secrets and tokens. */
export function hex(bytes: number): string {
  return randomBytes(bytes).toString("hex")
}

/** A date as Bachs writes it: ISO 8601 in UTC. */
export function iso(date: Date): string {
  return date.toISOString()
}

/** Money in minor units (hundredths) as Bachs writes it: a decimal string with two places. */
export function money(minor: number): string {
  const sign = minor < 0 ? "-" : ""
  const whole = Math.abs(minor)

  return `${sign}${Math.floor(whole / 100)}.${String(whole % 100).padStart(2, "0")}`
}

/** A decimal money string in minor units, or undefined when it is not one (`"29"`, `"29.5"`, `"29.00"`). */
export function minorOf(value: unknown): number | undefined {
  if (typeof value !== "string" || !/^\d+(\.\d{1,2})?$/.test(value)) return undefined

  const [whole = "0", fraction = ""] = value.split(".")

  return Number(whole) * 100 + Number(fraction.padEnd(2, "0"))
}

/** One field-level problem in a `VALIDATION_ERROR`. */
export interface FieldProblem {
  readonly field: string
  readonly message: string
  readonly type: string
}

/** Bachs's flat error object. */
export interface BachsErrorBody {
  readonly detail: string
  readonly error_code: string
  readonly doc_url?: string
  readonly errors?: readonly FieldProblem[]
}

/** The error body Bachs answers a failure with. */
export function errorBody(
  code: string,
  detail: string,
  problems?: readonly FieldProblem[],
): BachsErrorBody {
  return {
    detail,
    error_code: code,
    doc_url: "https://docs.bachs.io/api-reference/error-reference#general",
    ...(problems && { errors: problems }),
  }
}

/** An answer in Bachs's error format. */
export function bachsError(c: Context, status: number, code: string, detail: string): Response {
  return c.json(errorBody(code, detail), status)
}

/** An error a handler throws to answer in Bachs's format with a specific status and code. */
export class BachsFailure extends HttpError {
  readonly code: string
  readonly problems: readonly FieldProblem[] | undefined

  constructor(status: number, code: string, detail: string, problems?: readonly FieldProblem[]) {
    super(status, detail)
    this.code = code
    this.problems = problems
  }
}

/** Throws a 400 `VALIDATION_ERROR` naming the missing or invalid fields. */
export function invalid(detail: string, ...problems: FieldProblem[]): never {
  throw new BachsFailure(
    400,
    "VALIDATION_ERROR",
    detail,
    problems.length > 0 ? problems : undefined,
  )
}

/** Throws a 404 `NOT_FOUND` for `what`. */
export function notFound(what: string): never {
  throw new BachsFailure(404, "NOT_FOUND", `${what} not found`)
}

/** The JSON object a request sent, or a 400 when the body is not one. */
export async function bodyOf(c: Context): Promise<Record<string, unknown>> {
  const raw = await c.req.text()

  if (raw.trim() === "") return {}

  let parsed: unknown

  try {
    parsed = JSON.parse(raw)
  } catch {
    invalid("Request body is not valid JSON")
  }

  if (!isRecord(parsed)) invalid("Request body must be a JSON object")

  return parsed
}

/** A string field, or undefined when absent or not a string. */
export function text(body: Record<string, unknown>, key: string): string | undefined {
  const value = body[key]

  return typeof value === "string" ? value : undefined
}

/** A metadata object of string, number or boolean values; null when absent. */
export function metadataOf(value: unknown): Record<string, unknown> | null {
  if (value === undefined || value === null) return null
  if (!isRecord(value))
    invalid("metadata must be an object", {
      field: "metadata",
      message: "Must be an object",
      type: "type",
    })
  if (Object.keys(value).length > 20)
    throw new BachsFailure(400, "METADATA_LIMIT_EXCEEDED", "metadata accepts at most 20 keys")

  return value
}

/** The paging a list request asked for: a cursor (`cur_<offset>`) wins over an offset; limit clamped to 100. */
export function pagingOf(c: Context): { readonly limit: number; readonly offset: number } {
  const limit = Math.min(Math.max(Number(c.req.query("limit") ?? 20) || 20, 1), 100)
  const cursor = c.req.query("cursor")

  if (cursor !== undefined) {
    const match = /^cur_(\d+)$/.exec(cursor)

    if (!match)
      throw new BachsFailure(400, "BAD_REQUEST", "Invalid cursor format. Expected 'cur_<offset>'.")

    return { limit, offset: Number(match[1]) }
  }

  return { limit, offset: Math.max(Number(c.req.query("offset") ?? 0) || 0, 0) }
}

/** One page of `items` in Bachs's list shape: `items` and a `pagination` object. */
export function listPage<T>(c: Context, items: readonly T[]) {
  const { limit, offset } = pagingOf(c)
  const page = items.slice(offset, offset + limit)
  const next = offset + page.length

  return {
    items: page,
    pagination: {
      next_cursor: next < items.length ? `cur_${next}` : null,
      prev_cursor: offset > 0 ? `cur_${Math.max(offset - limit, 0)}` : null,
      has_more: next < items.length,
      limit,
      offset,
      returned: page.length,
      total: items.length,
    },
  }
}

/** Fields to change on a stored record, built up one by one. */
export type Changes<T> = { -readonly [K in keyof T]?: T[K] }

/** A date `ms` after `from`. */
export function later(from: Date, ms: number): Date {
  return new Date(from.getTime() + ms)
}
