import type { Context } from "../http.ts"
import type { Address } from "./entities.ts"

/** Reading Graph request bodies: JSON objects whose fields are checked as they are read. */

export type JsonObject = Record<string, unknown>

/** A JSON value as an object, or an empty one. */
export function asObject(value: unknown): JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : {}
}

/** The request's JSON body as an object; an empty or malformed body reads as `{}`. */
export async function jsonBody(c: Context): Promise<JsonObject> {
  try {
    return asObject(JSON.parse(await c.req.text()))
  } catch {
    return {}
  }
}

/** A string field, or `undefined` when the field holds anything else. */
export function text(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined
}

/** An array field's entries; anything else reads as none. */
export const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : [])

/** A boolean field, or `undefined` when the field holds anything else. */
export const flag = (value: unknown): boolean | undefined =>
  value === true || value === false ? value : undefined

/** A Graph recipient (`{ emailAddress: { name, address } }`) as an address. */
export function address(value: unknown): Address | null {
  const email = asObject(asObject(value).emailAddress)
  const mail = text(email.address)

  return mail ? { name: text(email.name) ?? mail, address: mail } : null
}

export function addresses(value: unknown): Address[] {
  return list(value)
    .map(address)
    .filter((a): a is Address => a !== null)
}

/** An item body's content and type; Graph's default type is HTML. */
export function itemBody(value: unknown): { type: "text" | "html"; content: string } | undefined {
  const body = asObject(value)
  const content = text(body.content)

  if (content === undefined) return undefined

  return { type: text(body.contentType)?.toLowerCase() === "text" ? "text" : "html", content }
}

/** The fields of `entries` that have a value, leaving out those that are `undefined`. */
export function present<T extends object>(entries: {
  [K in keyof T]: T[K] | undefined
}): Partial<T> {
  const kept: Partial<T> = {}

  for (const key in entries) {
    const value = entries[key]

    if (value !== undefined) kept[key] = value
  }

  return kept
}

/** `value` when it is one of `allowed`, else `undefined`. */
export function oneOf<T extends string>(allowed: readonly T[], value: unknown): T | undefined {
  return allowed.find((candidate) => candidate === value)
}
