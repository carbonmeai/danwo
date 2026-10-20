/**
 * A few builders for writing a documented answer's schema by hand, for providers that publish no
 * API description: the documentation's field tables, written as the JSON schema a step's `doc`
 * carries.
 */
import { OPEN } from "./openapi.ts"

type Schema = Readonly<Record<string, unknown>>

export const str: Schema = { type: "string" }
export const num: Schema = { type: "number" }
export const bool: Schema = { type: "boolean" }
/** Any value: a field the documentation names without describing. */
export const anything: Schema = {}
/** An answer with no body, such as a 204. */
export const noBody: Schema = { type: "null" }

/** `schema`, or null. */
export function nullable(schema: Schema): Schema {
  return { anyOf: [schema, { type: "null" }] }
}

export function arrayOf(items: Schema): Schema {
  return { type: "array", items }
}

/** An object with `required` keys and, optionally, keys that may be absent. */
export function object(
  required: Readonly<Record<string, Schema>>,
  optional: Readonly<Record<string, Schema>> = {},
): Schema {
  return {
    type: "object",
    required: Object.keys(required),
    properties: { ...required, ...optional },
  }
}

/** An object whose documentation lists only some of its fields: other fields are not extra. */
export function partialObject(
  required: Readonly<Record<string, Schema>>,
  optional: Readonly<Record<string, Schema>> = {},
): Schema {
  return { ...object(required, optional), [OPEN]: true }
}

/** A map of arbitrary keys, such as metadata. */
export const map: Schema = { type: "object" }
