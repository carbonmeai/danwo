/*
 * Redaction for what the flight recorder writes to disk: secret values the session knows, the
 * credentials an app's calls carry (headers, body fields, provider key formats), at any depth.
 */

import { REDACTED, redactCredentials } from "../secrets/index.ts"

/** Headers that carry credentials or signatures, by exact name or by a telling word in it. */
const SENSITIVE_HEADERS = new Set([
  "authorization",
  "proxy-authorization",
  "cookie",
  "set-cookie",
  "stripe-signature",
  "svix-signature",
  "verif-hash",
  "webhook-signature",
  "x-amz-security-token",
])
const SENSITIVE_HEADER_WORDS = /token|secret|signature|api[-_]?key|password|credential/i

/** Body and state fields whose values are credentials, whatever they hold. */
const SENSITIVE_KEYS =
  /^(pass(word|wd)?|secret|.*_?secret|token|.*_token|(access|refresh|bot|user|app|auth)_?token|api[-_]?key|authorization|signature|cookie|otp|one_time_code|private_?key|.*_?pem|secret_access_key|code_verifier|client_?state|download_?token|(secret|verif)_?hash)$/i

export interface Redactor {
  text(text: string): string
  headers(headers: Readonly<Record<string, string>>): Record<string, string>
  /** A request or response body: JSON and form fields by name, then the text itself. */
  body(body: string, contentType: string | undefined): string
  /** Any JSON-like value, deep: sensitive keys blanked, strings redacted and clipped. */
  value(value: unknown): unknown
  /** Like `value`, without clipping: for records whose text is the point (steps, errors). */
  deep<T>(value: T): T
}

/** Characters a string in recorded state keeps; base64 object bodies and blobs are clipped. */
const MAX_STATE_STRING = 500
/** Items an array in recorded state keeps. */
const MAX_STATE_ITEMS = 100

interface Walk {
  /** What a string becomes. */
  readonly leaf: (text: string) => string
  /** Items an array keeps; the rest are counted. */
  readonly maxItems: number
}

/** Deep copy of `input` with sensitive keys blanked and every string through `walk.leaf`. */
function redactDeep(input: unknown, walk: Walk, depth = 0): unknown {
  if (typeof input === "string") return walk.leaf(input)

  if (Array.isArray(input)) {
    const kept = input.slice(0, walk.maxItems).map((item) => redactDeep(item, walk, depth + 1))
    const dropped = input.length - kept.length

    return dropped > 0 ? [...kept, `… ${dropped} more`] : kept
  }

  if (input === null || typeof input !== "object" || depth >= 20) return input

  return Object.fromEntries(
    Object.entries(input).map(([key, v]) => [
      key,
      SENSITIVE_KEYS.test(key) ? REDACTED : redactDeep(v, walk, depth + 1),
    ]),
  )
}

/** A redactor over `secrets` (the session's known secret values) plus danwo's own rules. */
export function createRedactor(secrets: (text: string) => string): Redactor {
  const text = (input: string) => redactCredentials(secrets(input))
  const state: Walk = { leaf: (s) => clip(text(s)), maxItems: MAX_STATE_ITEMS }
  const body: Walk = { leaf: text, maxItems: Number.POSITIVE_INFINITY }

  return {
    text,
    headers: (headers) =>
      Object.fromEntries(
        Object.entries(headers).map(([name, v]) => [
          name,
          isSensitiveHeader(name) ? REDACTED : text(v),
        ]),
      ),
    body: (input, contentType) => text(redactFields(input, contentType ?? "", body)),
    value: (input) => redactDeep(input, state),
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the copy has the input's shape: only string values and sensitive keys' values change
    deep: <T>(input: T) => redactDeep(input, body) as T,
  }
}

function isSensitiveHeader(name: string): boolean {
  return SENSITIVE_HEADERS.has(name.toLowerCase()) || SENSITIVE_HEADER_WORDS.test(name)
}

function clip(text: string): string {
  return text.length > MAX_STATE_STRING
    ? `${text.slice(0, MAX_STATE_STRING)}… (${text.length} chars)`
    : text
}

/** Blanks sensitive fields of a JSON or form body; other bodies come back as they are. */
function redactFields(input: string, contentType: string, walk: Walk): string {
  if (/json/i.test(contentType)) return redactJson(input, walk)
  if (/x-www-form-urlencoded/i.test(contentType)) return redactForm(input)

  return input
}

function redactJson(input: string, walk: Walk): string {
  try {
    return JSON.stringify(redactDeep(JSON.parse(input), walk))
  } catch {
    // A body cut at the capture limit is not valid JSON; its text is still redacted.
    return input
  }
}

/** A form body, decoded for reading, with credential fields blanked. */
function redactForm(body: string): string {
  return [...new URLSearchParams(body)]
    .map(([key, v]) => `${key}=${isSensitiveField(key) ? REDACTED : v}`)
    .join("&")
}

/**
 * A form field by its leaf name, so Stripe's nested `payment_method_data[card][number]` counts.
 * `code` is an OAuth authorization code in a form; in JSON it is usually an error code, so only
 * forms blank it.
 */
function isSensitiveField(key: string): boolean {
  const leaf = /\[([^\]]+)\]$/.exec(key)?.[1] ?? key

  return SENSITIVE_KEYS.test(leaf) || /^(number|cvc|exp_month|exp_year|code)$/.test(leaf)
}
