/** Narrowing helpers for request bodies, parameters and other values of unknown shape. */
import { HttpError } from "./errors.ts"
import type { Context } from "./http.ts"

/** Whether `value` is a plain JSON object (not null, not an array). */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/** `value` when it is a plain JSON object, otherwise undefined. */
export function asRecord(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined
}

/** Whether `value` is one of `allowed`, such as a member of a string union. */
export function isOneOf<T extends string>(allowed: readonly T[], value: unknown): value is T {
  return allowed.some((item) => item === value)
}

/** `value` when it is one of `allowed`, otherwise `fallback`. */
export function oneOf<T extends string>(allowed: readonly T[], value: unknown, fallback: T): T {
  return isOneOf(allowed, value) ? value : fallback
}

/**
 * A request's JSON object body: `{}` when it is empty or not an object, a 400 when it is not
 * JSON at all.
 */
export async function jsonObjectOf(c: Context): Promise<Record<string, unknown>> {
  const raw = await c.req.text()

  if (raw.trim() === "") return {}

  try {
    return asRecord(JSON.parse(raw)) ?? {}
  } catch {
    throw new HttpError(400, "Request body is not valid JSON")
  }
}
