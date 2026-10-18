/**
 * How an emulator's answer differs from the real provider's: compared by structure, with each
 * difference named by its kind so a report reads as "missing field" rather than as a JSON diff.
 */
import type { Shape } from "./shape.ts"

/** What kind of difference was found. */
export type DifferenceKind =
  | "missing-field"
  | "extra-field"
  | "type-mismatch"
  | "status-mismatch"
  | "error-code-mismatch"
  | "ordering"
  | "missing-step"

/** One difference at one path of one answer. */
export interface Difference {
  readonly kind: DifferenceKind
  /** Dot path inside the answer (`data[].status`), or empty for the answer as a whole. */
  readonly path: string
  readonly expected: string
  readonly actual: string
}

type ObjectShape = Extract<Shape, { t: "object" }>

/** A shape in a few words, for a report line. */
function describeShape(shape: Shape): string {
  switch (shape.t) {
    case "literal":
      return JSON.stringify(shape.v)
    case "array":
      return shape.of === null ? "empty array" : `array of ${describeShape(shape.of)}`
    case "union":
      return shape.of.map(describeShape).join(" | ")
    case "object":
      return "object"
    default:
      return shape.t
  }
}

/** Whether a mismatch at `path` is about an error's code or type rather than the data's shape. */
function isErrorPath(path: string): boolean {
  return /(^|\.)(error|errors)(\.|\[|$)/.test(path) || ["code", "name", "type"].includes(path)
}

function mismatch(path: string, expected: Shape, actual: Shape): Difference {
  const kind =
    expected.t === "literal" && actual.t === "literal" && isErrorPath(path)
      ? "error-code-mismatch"
      : "type-mismatch"

  return { kind, path, expected: describeShape(expected), actual: describeShape(actual) }
}

function primitiveOf(shape: Shape): string {
  return shape.t === "literal" ? typeof shape.v : shape.t
}

function compareLeaf(expected: Shape, actual: Shape, path: string): Difference[] {
  if (expected.t === "literal") {
    if (actual.t === "literal")
      return actual.v === expected.v ? [] : [mismatch(path, expected, actual)]

    return primitiveOf(actual) === typeof expected.v ? [] : [mismatch(path, expected, actual)]
  }

  return primitiveOf(actual) === expected.t ? [] : [mismatch(path, expected, actual)]
}

function child(path: string, key: string): string {
  return path === "" ? key : `${path}.${key}`
}

function compareObjects(expected: ObjectShape, actual: ObjectShape, path: string): Difference[] {
  const optional = new Set(expected.optional ?? [])
  const found = Object.entries(expected.keys).flatMap(([key, shape]) => {
    const other = actual.keys[key]

    if (other === undefined)
      return optional.has(key)
        ? []
        : [
            {
              kind: "missing-field" as const,
              path: child(path, key),
              expected: describeShape(shape),
              actual: "absent",
            },
          ]

    return compareShapes(shape, other, child(path, key))
  })

  if (expected.open === true) return found

  const extra = Object.keys(actual.keys)
    .filter((key) => !(key in expected.keys))
    .map((key) => ({
      kind: "extra-field" as const,
      path: child(path, key),
      expected: "absent",
      actual: describeShape(actual.keys[key] ?? { t: "any" }),
    }))

  return [...found, ...extra]
}

/** The kind of value a shape describes, with literals counted as their primitive type. */
function kindOf(shape: Shape): string {
  return shape.t === "literal" ? typeof shape.v : shape.t
}

/**
 * The differences against the closest member of an expected union: a matching member wins,
 * otherwise a member of the same kind (an expanded object against the object alternative, not
 * against the id alternative), otherwise the member with the fewest differences.
 */
function compareUnion(members: readonly Shape[], actual: Shape, path: string): Difference[] {
  const tries = members.map((member) => ({ member, diffs: compareShapes(member, actual, path) }))
  const exact = tries.find((attempt) => attempt.diffs.length === 0)

  if (exact !== undefined) return []

  const sameKind = tries.filter((attempt) => kindOf(attempt.member) === kindOf(actual))
  const pool = sameKind.length > 0 ? sameKind : tries

  return pool.toSorted((a, b) => a.diffs.length - b.diffs.length)[0]?.diffs ?? []
}

type ArrayShape = Extract<Shape, { t: "array" }>

function compareArrays(expected: ArrayShape, actual: Shape, path: string): Difference[] {
  if (actual.t !== "array") return [mismatch(path, expected, actual)]

  return expected.of === null || actual.of === null
    ? []
    : compareShapes(expected.of, actual.of, `${path}[]`)
}

function compareObjectShape(expected: ObjectShape, actual: Shape, path: string): Difference[] {
  return actual.t === "object"
    ? compareObjects(expected, actual, path)
    : [mismatch(path, expected, actual)]
}

/** Every difference between what was expected and what came back. */
export function compareShapes(expected: Shape, actual: Shape, path = ""): Difference[] {
  if (expected.t === "any" || actual.t === "any") return []
  if (actual.t === "union")
    return actual.of.flatMap((member) => compareShapes(expected, member, path))
  if (expected.t === "union") return compareUnion(expected.of, actual, path)
  if (expected.t === "object") return compareObjectShape(expected, actual, path)
  if (expected.t === "array") return compareArrays(expected, actual, path)

  return compareLeaf(expected, actual, path)
}
