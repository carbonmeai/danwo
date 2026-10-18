/**
 * The structure of a JSON answer with its values left out: what fidelity compares. Ids, times,
 * amounts and secrets never reach a shape; only the paths a scenario names as literals (such as
 * `object`, `status` or `error.code`) keep their value, because those values are part of the API.
 */

/** A JSON value's structure. */
export type Shape =
  | { readonly t: "any" }
  | { readonly t: "null" | "string" | "number" | "boolean" }
  | { readonly t: "literal"; readonly v: string | number | boolean }
  | { readonly t: "array"; readonly of: Shape | null }
  | {
      readonly t: "object"
      readonly keys: Readonly<Record<string, Shape>>
      /** Keys that may be absent: an expandable or conditional field. */
      readonly optional?: readonly string[]
      /** Accepts keys it does not list, such as a metadata map. */
      readonly open?: boolean
    }
  | { readonly t: "union"; readonly of: readonly Shape[] }

/** A JSON value as `JSON.parse` returns it. */
export type Json =
  | null
  | boolean
  | number
  | string
  | readonly Json[]
  | { readonly [k: string]: Json }

/** Paths whose values are kept, and paths that are maps of arbitrary keys (`metadata`). */
export interface ShapeOptions {
  readonly literals?: readonly string[]
  readonly maps?: readonly string[]
}

const ALWAYS_LITERAL = ["object", "**.object"]
const ALWAYS_MAP = ["metadata", "**.metadata"]

/**
 * Whether `path` matches `pattern`. Paths are dot separated with `[]` after an array's name
 * (`data[].object`); a pattern matches its path exactly, or anywhere when it starts with `**.`.
 */
export function pathMatches(path: string, pattern: string): boolean {
  if (!pattern.startsWith("**.")) return path === pattern

  const tail = pattern.slice(3)

  return path === tail || path.endsWith(`.${tail}`)
}

function matchesAny(path: string, patterns: readonly string[]): boolean {
  return patterns.some((pattern) => pathMatches(path, pattern))
}

/** Whether a JSON value is an array. */
export function isJsonArray(value: Json): value is readonly Json[] {
  return Array.isArray(value)
}

function isRecord(value: Json): value is { readonly [k: string]: Json } {
  return typeof value === "object" && value !== null && !isJsonArray(value)
}

/** A JSON value as an object, or undefined when it is not one. */
export function asJsonObject(value: Json | undefined): { readonly [k: string]: Json } | undefined {
  return value !== undefined && isRecord(value) ? value : undefined
}

/** The structure of `value`, keeping the values of literal paths only. */
export function shapeOf(value: Json, options: ShapeOptions = {}, path = ""): Shape {
  const literals = [...ALWAYS_LITERAL, ...(options.literals ?? [])]

  if (value === null) return { t: "null" }
  if (isJsonArray(value)) return arrayShape(value, options, path)
  if (isRecord(value)) return objectShape(value, options, path)
  if (path !== "" && matchesAny(path, literals)) return { t: "literal", v: value }

  return {
    t: typeof value === "string" ? "string" : typeof value === "number" ? "number" : "boolean",
  }
}

function arrayShape(items: readonly Json[], options: ShapeOptions, path: string): Shape {
  const shapes = items.map((item) => shapeOf(item, options, `${path}[]`))

  return { t: "array", of: shapes.length === 0 ? null : shapes.reduce(mergeShapes) }
}

function objectShape(
  record: { readonly [k: string]: Json },
  options: ShapeOptions,
  path: string,
): Shape {
  if (path !== "" && matchesAny(path, [...ALWAYS_MAP, ...(options.maps ?? [])]))
    return { t: "object", keys: {}, open: true }

  const keys = Object.fromEntries(
    Object.entries(record).map(([key, child]): [string, Shape] => [
      key,
      shapeOf(child, options, path === "" ? key : `${path}.${key}`),
    ]),
  )

  return { t: "object", keys }
}

function sameShape(a: Shape, b: Shape): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

function membersOf(shape: Shape): readonly Shape[] {
  return shape.t === "union" ? shape.of : [shape]
}

/** A union of both shapes' members, each once; a single member stands for itself. */
function unionOf(a: Shape, b: Shape): Shape {
  const members = [...membersOf(a), ...membersOf(b)]
  const distinct = members.filter((m, i) => members.findIndex((other) => sameShape(other, m)) === i)

  return distinct.length === 1 && distinct[0] !== undefined
    ? distinct[0]
    : { t: "union", of: distinct }
}

type ArrayShape = Extract<Shape, { t: "array" }>

function mergeArrays(a: ArrayShape, b: ArrayShape): Shape {
  if (a.of === null || b.of === null) return { t: "array", of: a.of ?? b.of }

  return { t: "array", of: mergeShapes(a.of, b.of) }
}

/** One shape covering both: what two items of one array look like together. */
function mergeShapes(a: Shape, b: Shape): Shape {
  if (sameShape(a, b)) return a
  if (a.t === "object" && b.t === "object") return mergeObjects(a, b)
  if (a.t === "array" && b.t === "array") return mergeArrays(a, b)

  return unionOf(a, b)
}

type ObjectShape = Extract<Shape, { t: "object" }>

function mergeObjects(a: ObjectShape, b: ObjectShape): Shape {
  const names = [...new Set([...Object.keys(a.keys), ...Object.keys(b.keys)])]
  const optional = names.filter(
    (name) =>
      !(name in a.keys) ||
      !(name in b.keys) ||
      a.optional?.includes(name) ||
      b.optional?.includes(name),
  )
  const keys = Object.fromEntries(
    names.map((name): [string, Shape] => {
      const left = a.keys[name]
      const right = b.keys[name]

      return [
        name,
        left === undefined
          ? (right ?? { t: "any" })
          : right === undefined
            ? left
            : mergeShapes(left, right),
      ]
    }),
  )

  return {
    t: "object",
    keys,
    ...(optional.length > 0 && { optional }),
    ...((a.open === true || b.open === true) && { open: true }),
  }
}
