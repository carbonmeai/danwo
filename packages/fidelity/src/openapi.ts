/**
 * Goldens from a provider's published API description, for when no sandbox credentials are at hand:
 * each scenario step names the operation its answer comes from, and the answer's schema becomes
 * the expected shape. Such a golden is looser than one recorded from the sandbox (a field the
 * schema calls optional may be absent), and is replaced by a recorded one the first time a live run
 * updates it.
 */
import { readFile } from "node:fs/promises"

import { parse as parseYaml } from "yaml"

import type { StepDoc } from "./scenario.ts"
import { pathMatches, type Shape } from "./shape.ts"

/** A JSON-schema node, as the description writes it. */
type Schema = { readonly [key: string]: unknown }

/** The parts of an API description fidelity reads. */
export interface ApiDescription {
  readonly paths: Readonly<Record<string, Readonly<Record<string, unknown>>>>
  readonly components?: { readonly schemas?: Readonly<Record<string, Schema>> }
}

/**
 * How many named schemas deep a shape is expanded before the rest is accepted as anything: the
 * answer's own object and the objects it embeds directly. Deeper levels would make goldens tens of
 * megabytes while checking objects other scenarios read first-hand.
 */
const MAX_DEPTH = 2

const LITERAL_PATHS = ["object", "**.object"]

/**
 * Marks a hand-written object schema whose documentation lists only some of its fields, so fields
 * it does not list are not reported as extra.
 */
export const OPEN = "x-danwo-open"

function isSchema(value: unknown): value is Schema {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function asSchemas(value: unknown): Schema[] {
  return Array.isArray(value) ? value.filter(isSchema) : []
}

/** Reads an API description from a `.json`, `.yaml` or `.yml` file. */
export async function readDescription(file: string): Promise<ApiDescription> {
  const text = await readFile(file, "utf8")
  const parsed: unknown = file.endsWith(".json") ? JSON.parse(text) : parseYaml(text)

  if (!isSchema(parsed) || !isSchema(parsed["paths"]))
    throw new Error(`${file} is not an API description with paths`)

  const description: ApiDescription = { paths: {}, ...parsed }

  return description
}

interface Walk {
  readonly description: ApiDescription
  readonly seen: readonly string[]
  readonly path: string
  /** Every property may also be null: for descriptions that leave nullability out. */
  readonly looseNulls: boolean
}

/** A property's shape, widened to allow null when the description does not say. */
function propertyShape(child: Schema, walk: Walk): Shape {
  const shape = schemaShape(child, walk)

  return walk.looseNulls ? union([shape, { t: "null" }]) : shape
}

function resolve(schema: Schema, walk: Walk): { schema: Schema; walk: Walk } | undefined {
  const ref = schema["$ref"]

  if (typeof ref !== "string") return { schema, walk }

  const name = ref.split("/").at(-1) ?? ref
  const target = walk.description.components?.schemas?.[name]

  if (target === undefined || walk.seen.includes(name) || walk.seen.length >= MAX_DEPTH)
    return undefined

  return { schema: target, walk: { ...walk, seen: [...walk.seen, name] } }
}

function union(members: readonly Shape[]): Shape {
  const distinct = members.filter(
    (m, i) => members.findIndex((o) => JSON.stringify(o) === JSON.stringify(m)) === i,
  )

  return distinct.length === 1 && distinct[0] !== undefined
    ? distinct[0]
    : { t: "union", of: distinct }
}

function typesOf(schema: Schema): string[] {
  const type = schema["type"]
  const types = Array.isArray(type)
    ? type.filter((t): t is string => typeof t === "string")
    : typeof type === "string"
      ? [type]
      : []

  return schema["nullable"] === true ? [...types, "null"] : types
}

function objectSchemaShape(schema: Schema, walk: Walk): Shape {
  const properties = isSchema(schema["properties"]) ? schema["properties"] : {}
  const required = Array.isArray(schema["required"])
    ? schema["required"].filter((r): r is string => typeof r === "string")
    : []
  const names = Object.keys(properties)

  if (names.length === 0) return { t: "object", keys: {}, open: true }

  const keys = Object.fromEntries(
    names.map((name): [string, Shape] => {
      const child = properties[name]
      const path = walk.path === "" ? name : `${walk.path}.${name}`

      return [name, isSchema(child) ? propertyShape(child, { ...walk, path }) : { t: "any" }]
    }),
  )
  const optional = names.filter((name) => !required.includes(name))

  return {
    t: "object",
    keys,
    ...(optional.length > 0 && { optional }),
    ...(schema[OPEN] === true && { open: true }),
  }
}

function arraySchemaShape(schema: Schema, walk: Walk): Shape {
  const items = schema["items"]

  return {
    t: "array",
    of: isSchema(items) ? schemaShape(items, { ...walk, path: `${walk.path}[]` }) : null,
  }
}

/** A literal path's enum as a union of its values, or undefined for any other path. */
function enumShape(schema: Schema, walk: Walk): Shape | undefined {
  const values = Array.isArray(schema["enum"]) ? schema["enum"] : []

  if (values.length === 0 || !LITERAL_PATHS.some((pattern) => pathMatches(walk.path, pattern)))
    return undefined

  return union(
    values
      .filter((v): v is string | number | boolean =>
        ["string", "number", "boolean"].includes(typeof v),
      )
      .map((v) => ({ t: "literal", v })),
  )
}

function primitiveShape(type: string): Shape {
  if (type === "integer" || type === "number") return { t: "number" }

  return type === "boolean" ? { t: "boolean" } : { t: "string" }
}

function typedShape(type: string, schema: Schema, walk: Walk): Shape {
  if (type === "null") return { t: "null" }
  if (type === "object") return objectSchemaShape(schema, walk)
  if (type === "array") return arraySchemaShape(schema, walk)

  return enumShape(schema, walk) ?? primitiveShape(type)
}

/** A named schema's body, for `allOf` members, which extend a schema rather than nest it. */
function named(member: Schema, description: ApiDescription): Schema | undefined {
  const ref = member["$ref"]

  if (typeof ref !== "string") return member

  return description.components?.schemas?.[ref.split("/").at(-1) ?? ref]
}

/**
 * One object schema from an `allOf` chain, properties and required names merged from every
 * member, each base expanded in turn: an entity's own fields together with those it inherits.
 */
function mergedAllOf(schema: Schema, description: ApiDescription, depth = 0): Schema {
  const members = asSchemas(schema["allOf"])
  const merged: { properties: Record<string, unknown>; required: string[] } = {
    properties: {},
    required: [],
  }
  const parts = [{ ...schema, allOf: undefined }, ...members]

  for (const part of parts) {
    const body = named(part, description)
    const flat =
      body === undefined ? {} : depth < 8 ? mergedAllOf(body, description, depth + 1) : body

    Object.assign(merged.properties, isSchema(flat["properties"]) ? flat["properties"] : {})
    if (Array.isArray(flat["required"]))
      merged.required.push(...flat["required"].filter((r): r is string => typeof r === "string"))
  }

  return members.length === 0 ? schema : { type: "object", ...merged }
}

/** The shape a schema describes, with named schemas expanded to {@link MAX_DEPTH}. */
function schemaShape(node: Schema, walk: Walk): Shape {
  const resolved = resolve(node, walk)

  if (resolved === undefined) return { t: "any" }

  const schema = mergedAllOf(resolved.schema, walk.description)
  const alternatives = [...asSchemas(schema["anyOf"]), ...asSchemas(schema["oneOf"])]

  if (alternatives.length > 0) {
    const members = alternatives.map((member) => schemaShape(member, resolved.walk))

    return union(schema["nullable"] === true ? [...members, { t: "null" }] : members)
  }

  const types = typesOf(schema)

  if (types.length === 0)
    return isSchema(schema["properties"]) ? objectSchemaShape(schema, resolved.walk) : { t: "any" }

  return union(types.map((type) => typedShape(type, schema, resolved.walk)))
}

function jsonSchemaOf(response: unknown): Schema | undefined {
  if (!isSchema(response) || !isSchema(response["content"])) return undefined

  const json = Object.entries(response["content"]).find(([type]) => type.includes("json"))?.[1]

  return isSchema(json) && isSchema(json["schema"]) ? json["schema"] : undefined
}

type Literal = string | number | boolean

/** Puts `value` at `path` inside an object shape's key, `name[]` stepping into that array. */
function objectWithLiteral(
  shape: Extract<Shape, { t: "object" }>,
  head: string,
  rest: readonly string[],
  value: Literal,
): Shape {
  const name = head.endsWith("[]") ? head.slice(0, -2) : head
  const child = shape.keys[name]
  const next = head.endsWith("[]") ? ["[]", ...rest] : rest

  return child === undefined
    ? shape
    : { ...shape, keys: { ...shape.keys, [name]: withLiteral(child, next, value) } }
}

/** Puts `value` at `path` inside `shape`, through objects, arrays and unions. */
function withLiteral(shape: Shape, path: readonly string[], value: Literal): Shape {
  const [head, ...rest] = path

  if (head === undefined) return { t: "literal", v: value }
  if (shape.t === "union")
    return { t: "union", of: shape.of.map((member) => withLiteral(member, path, value)) }
  if (shape.t === "object") return objectWithLiteral(shape, head, rest, value)
  if (shape.t !== "array" || head !== "[]" || shape.of === null) return shape

  return { t: "array", of: withLiteral(shape.of, rest, value) }
}

/** The schema of the answer an operation gives with `status`, falling back to its default answer. */
function operationSchema(
  description: ApiDescription,
  operation: string,
  status: number,
): Schema | undefined {
  const [method = "", path = ""] = operation.split(" ")
  const found = description.paths[path]?.[method.toLowerCase()]
  const responses = isSchema(found) && isSchema(found["responses"]) ? found["responses"] : {}

  return jsonSchemaOf(responses[String(status)] ?? responses["default"])
}

/**
 * The documented shape of one step's answer, with the step's fixed values filled in. With
 * `looseNulls`, any property may be null, for descriptions that do not mark nullable fields.
 */
export function documentedShape(
  description: ApiDescription,
  doc: StepDoc,
  looseNulls = false,
): Shape {
  const schema =
    doc.schema ??
    (doc.operation === undefined
      ? undefined
      : operationSchema(description, doc.operation, doc.status))

  if (schema === undefined)
    throw new Error(
      `no documented JSON answer for ${doc.operation ?? "an undescribed step"} ${doc.status}`,
    )

  const shape = schemaShape(schema, { description, seen: [], path: "", looseNulls })

  return Object.entries(doc.literals ?? {}).reduce(
    (current, [at, value]) => withLiteral(current, at.split("."), value),
    shape,
  )
}
