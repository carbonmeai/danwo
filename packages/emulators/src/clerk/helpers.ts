import { createHash, randomBytes } from "node:crypto"

import { HttpError } from "../errors.ts"

/** The Backend API's host: what an app's server calls with its secret key. */
export const BAPI_HOST = "api.clerk.com"

/**
 * The hosts a Clerk development instance answers on: the Backend API, the Frontend API
 * (`<slug>.clerk.accounts.dev`) and the Account Portal (`<slug>.accounts.dev`). Route them to the
 * emulator; the instance is told apart by the slug in the host.
 */
export const CLERK_HOSTS = [BAPI_HOST, "*.clerk.accounts.dev", "*.accounts.dev"] as const

/** Whether `host` is one a Clerk development instance answers on. */
export function isClerkHost(host: string): boolean {
  return host === BAPI_HOST || host.endsWith(".accounts.dev")
}

const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"

/** A Clerk-style id: a type prefix and 27 random base-62 characters, e.g. `user_2x…`. */
export function clerkId(prefix: string): string {
  const bytes = randomBytes(27)

  return `${prefix}_${[...bytes].map((byte) => ALPHABET[byte % ALPHABET.length]).join("")}`
}

/**
 * A Clerk-style id derived from `name`, the same on every run and after every reset, e.g.
 * `stableClerkId("user", "ada@example.com")`: seeded records keep the ids an app's own database
 * was seeded with.
 */
export function stableClerkId(prefix: string, name: string): string {
  const bytes = createHash("sha256").update(`${prefix}:${name}`).digest()

  return `${prefix}_${[...bytes.subarray(0, 27)].map((byte) => ALPHABET[byte % ALPHABET.length]).join("")}`
}

/** A random opaque secret, base64url. */
export function secretToken(bytes = 24): string {
  return randomBytes(bytes).toString("base64url")
}

/** One entry of a Clerk error answer. */
export interface ClerkErrorEntry {
  readonly message: string
  readonly long_message: string
  readonly code: string
  readonly meta?: Readonly<Record<string, unknown>>
}

/** Clerk's error answer: a list of errors and a trace id. */
export function clerkErrorBody(errors: readonly ClerkErrorEntry[]) {
  return { errors, clerk_trace_id: secretToken(16) }
}

/** A failure a handler throws; the error hook answers it in Clerk's error format. */
export class ClerkFailure extends HttpError {
  readonly entry: ClerkErrorEntry

  constructor(status: number, code: string, message: string, longMessage = message, meta = {}) {
    super(status, message)
    this.entry = { message, long_message: longMessage, code, meta }
  }
}

/** 404 for an id or resource the instance does not have. */
export function notFound(what = "resource"): ClerkFailure {
  return new ClerkFailure(
    404,
    "resource_not_found",
    "not found",
    `The requested ${what} could not be found.`,
  )
}

/** 422 for a missing or unusable parameter. */
export function invalidParameter(name: string, message = `${name} is invalid.`): ClerkFailure {
  return new ClerkFailure(422, "form_param_format_invalid", "is invalid", message, {
    param_name: name,
  })
}

/**
 * The publishable key of a Frontend API host: `pk_test_` and the host with a trailing `$`,
 * base64-encoded without padding, as Clerk's SDKs decode it.
 */
export function publishableKeyFor(frontendApi: string): string {
  return `pk_test_${Buffer.from(`${frontendApi}$`).toString("base64").replace(/=+$/, "")}`
}

/** The suffix Clerk's SDKs append to cookie names for this publishable key. */
export function cookieSuffix(publishableKey: string): string {
  return createHash("sha1")
    .update(publishableKey)
    .digest("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .slice(0, 8)
}

/** The value of a string field in a JSON body or query, if it is one. */
export function str(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined
}

/** The value of a number field, if it is one or a numeric string. */
export function num(value: unknown): number | undefined {
  if (typeof value === "number") return value
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value)))
    return Number(value)

  return undefined
}

/** The strings of a field given once or as a list. */
export function strings(value: unknown): string[] {
  if (typeof value === "string") return [value]
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string")

  return []
}

/** A plain object field, or an empty object. */
export function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return {}

  return Object.fromEntries(Object.entries(value))
}
