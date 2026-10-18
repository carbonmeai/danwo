/**
 * A small JSON Schema check for scripted structured answers: types, required and extra properties,
 * enums and array items. Enough to catch a script that would not satisfy the schema the app asked
 * for, which a real model's structured output would.
 */
import { isRecord } from "../json.ts"

/** The JSON type of `value`, with whole numbers as `integer`. */
function typeOf(value: unknown): string {
  if (value === null) return "null"
  if (Array.isArray(value)) return "array"
  if (Number.isInteger(value)) return "integer"

  return typeof value
}

function typeFits(value: unknown, expected: unknown): boolean {
  const allowed = Array.isArray(expected) ? expected : [expected]
  const actual = typeOf(value)

  return allowed.some((type) => type === actual || (type === "number" && actual === "integer"))
}

function objectProblems(
  value: Record<string, unknown>,
  schema: Record<string, unknown>,
  path: string,
): string[] {
  const properties = isRecord(schema.properties) ? schema.properties : {}
  const required = Array.isArray(schema.required) ? schema.required : []
  const missing = required
    .filter((key): key is string => typeof key === "string" && !(key in value))
    .map((key) => `${path}.${key} is required`)
  const extra =
    schema.additionalProperties === false
      ? Object.keys(value)
          .filter((key) => !(key in properties))
          .map((key) => `${path}.${key} is not allowed`)
      : []
  const nested = Object.entries(properties).flatMap(([key, child]) =>
    key in value ? schemaProblems(value[key], child, `${path}.${key}`) : [],
  )

  return [...missing, ...extra, ...nested]
}

function shapeProblems(value: unknown, schema: Record<string, unknown>, path: string): string[] {
  if (isRecord(value)) return objectProblems(value, schema, path)
  if (Array.isArray(value) && schema.items !== undefined)
    return value.flatMap((item, index) => schemaProblems(item, schema.items, `${path}[${index}]`))

  return []
}

/** Where `value` breaks `schema`, as readable paths; empty when it fits. */
export function schemaProblems(value: unknown, schema: unknown, path = "$"): string[] {
  if (!isRecord(schema)) return []
  if (Array.isArray(schema.enum) && !schema.enum.includes(value))
    return [`${path} must be one of ${JSON.stringify(schema.enum)}`]
  if (schema.type !== undefined && !typeFits(value, schema.type))
    return [`${path} must be ${JSON.stringify(schema.type)}, not ${typeOf(value)}`]

  return shapeProblems(value, schema, path)
}
