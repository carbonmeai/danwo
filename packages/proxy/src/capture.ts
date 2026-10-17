import type { CompletedBody, Headers as MockttpHeaders } from "mockttp"

/** Bytes of one body an exchange keeps; the rest is dropped and the body marked truncated. */
export const MAX_CAPTURED_BODY_BYTES = 16 * 1024

/**
 * One side of an exchange as the proxy saw it: headers, and the body as text when its type is
 * text-like (JSON, XML, forms, `text/*`), cut at `MAX_CAPTURED_BODY_BYTES`. Captured raw: secrets
 * are in here, so whatever persists it redacts it first (the runner's flight recorder does).
 */
export interface CapturedMessage {
  readonly headers: Readonly<Record<string, string>>
  /** Null for an empty or binary body; `bytes` still counts it. */
  readonly body: string | null
  readonly bytes: number
  readonly truncated: boolean
}

const TEXT_TYPES = /^(text\/|application\/(.+\+)?(json|xml|x-www-form-urlencoded|javascript))/i

function flatHeaders(headers: MockttpHeaders): Record<string, string> {
  const out: Record<string, string> = {}

  for (const [name, value] of Object.entries(headers)) {
    if (value !== undefined && !name.startsWith(":"))
      out[name] = Array.isArray(value) ? value.join(", ") : value
  }

  return out
}

/** Captures headers and a bounded text body; never throws (an undecodable body is kept as binary). */
export async function captureMessage(
  headers: MockttpHeaders,
  body: CompletedBody,
): Promise<CapturedMessage> {
  const flat = flatHeaders(headers)
  const bytes = (await body.getDecodedBuffer().catch(() => undefined)) ?? body.buffer
  const text = bytes.length > 0 && TEXT_TYPES.test(flat["content-type"] ?? "")
  const truncated = text && bytes.length > MAX_CAPTURED_BODY_BYTES

  return {
    headers: flat,
    body: text ? bytes.subarray(0, MAX_CAPTURED_BODY_BYTES).toString("utf8") : null,
    bytes: bytes.length,
    truncated,
  }
}
