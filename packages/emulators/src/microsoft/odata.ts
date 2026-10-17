import type { Context } from "../http.ts"
import { asObject, oneOf } from "./input.ts"

/**
 * The OData query options Graph clients send on list requests: `$filter` (a subset), `$orderby`,
 * `$top`, `$skip` and `$select`, applied to the JSON objects a list returns. `$filter` accepts
 * comparisons joined by `and`: a property path (`from/emailAddress/address`), an operator (`eq`,
 * `ne`, `gt`, `ge`, `lt`, `le`) and a literal (`true`, `false`, a number, `'text'`, or a date-time).
 */

type Json = Record<string, unknown>

/** A comparison in a `$filter`. */
interface Condition {
  readonly path: readonly string[]
  readonly op: "eq" | "ne" | "gt" | "ge" | "lt" | "le"
  readonly value: unknown
}

const OPERATORS = ["eq", "ne", "gt", "ge", "lt", "le"] as const

/** A `$filter` the emulator cannot evaluate. */
export class UnsupportedFilter extends Error {}

const CONDITION = /^([A-Za-z][\w/]*)\s+(eq|ne|gt|ge|lt|le)\s+(.+)$/

function literal(raw: string): unknown {
  const text = raw.trim()

  if (text === "true" || text === "false") return text === "true"
  if (text === "null") return null
  if (/^'.*'$/.test(text)) return text.slice(1, -1).replaceAll("''", "'")
  if (/^-?\d+(\.\d+)?$/.test(text)) return Number(text)
  if (!Number.isNaN(Date.parse(text))) return text

  throw new UnsupportedFilter(`unsupported literal ${text}`)
}

/** Parses `$filter` into conditions, all of which must hold. */
function parseFilter(filter: string): Condition[] {
  return filter.split(/\s+and\s+/i).map((part) => {
    const match = CONDITION.exec(part.trim())

    if (!match) throw new UnsupportedFilter(`unsupported filter clause ${part}`)

    const [, path = "", op = "eq", value = ""] = match

    return { path: path.split("/"), op: oneOf(OPERATORS, op) ?? "eq", value: literal(value) }
  })
}

function valueAt(item: Json, path: readonly string[]): unknown {
  let current: unknown = item

  for (const key of path) current = asObject(current)[key]

  return current
}

/** Orders two strings: date-times by time, other text case-insensitively. */
function compareText(a: string, b: string): number {
  const [ta, tb] = [Date.parse(a), Date.parse(b)]

  if (!Number.isNaN(ta) && !Number.isNaN(tb) && /\d{4}-\d{2}-\d{2}/.test(a)) return ta - tb

  return a.toLowerCase().localeCompare(b.toLowerCase())
}

/** Orders two property values: dates by time, everything else by its natural order. */
function compareValues(a: unknown, b: unknown): number {
  if (typeof a === "string" && typeof b === "string") return compareText(a, b)
  if (typeof a === "number" && typeof b === "number") return a - b
  if (typeof a === "boolean" && typeof b === "boolean") return Number(a) - Number(b)

  return a === b ? 0 : String(a).localeCompare(String(b))
}

const TESTS: Readonly<Record<Condition["op"], (order: number) => boolean>> = {
  eq: (o) => o === 0,
  ne: (o) => o !== 0,
  gt: (o) => o > 0,
  ge: (o) => o >= 0,
  lt: (o) => o < 0,
  le: (o) => o <= 0,
}

function holds(item: Json, condition: Condition): boolean {
  return TESTS[condition.op](compareValues(valueAt(item, condition.path), condition.value))
}

/** Sorts by `$orderby` (`field [asc|desc], …`); without one, `fallback` decides. */
function ordered(items: Json[], orderby: string | undefined, fallback: string | undefined): Json[] {
  const keys = (orderby ?? fallback ?? "")
    .split(",")
    .map((part) => part.trim().split(/\s+/))
    .filter(([path]) => path)
    .map(([path = "", direction]) => ({
      path: path.split("/"),
      sign: direction?.toLowerCase() === "desc" ? -1 : 1,
    }))

  return items.toSorted((a, b) => {
    for (const key of keys) {
      const order = compareValues(valueAt(a, key.path), valueAt(b, key.path))

      if (order !== 0) return order * key.sign
    }

    return 0
  })
}

/** Keeps `id`, `@odata.*` annotations and the `$select`ed properties. */
export function selected(item: Json, select: string | undefined): Json {
  if (!select) return item

  const keep = new Set(select.split(",").map((field) => field.trim()))

  return Object.fromEntries(
    Object.entries(item).filter(
      ([key]) => key === "id" || key.startsWith("@odata.") || keep.has(key),
    ),
  )
}

/** The page size a request asked for with `$top` or `Prefer: odata.maxpagesize`. */
export function pageSize(c: Context, fallback: number, max = 1000): number {
  const top = Number(c.req.query("$top"))
  const prefer = /odata\.maxpagesize=(\d+)/.exec(c.req.header("prefer") ?? "")?.[1]
  const asked = Number.isInteger(top) && top > 0 ? top : Number(prefer ?? fallback)

  return Math.min(Math.max(asked, 1), max)
}

/** The request URL with `name` set to `value`, as Graph writes next links. */
export function withParam(url: string, name: string, value: string): string {
  const next = new URL(url)

  next.searchParams.set(name, value)

  return next.toString()
}

export interface ListOptions {
  /** Ordering when the request gives no `$orderby`. */
  readonly defaultOrder?: string
  readonly defaultPageSize?: number
  readonly context?: string
}

/**
 * One page of `items` under the request's query options, as Graph's collection response:
 * `value`, and `@odata.nextLink` (with `$skip`) while more remain.
 */
export function listResponse(c: Context, items: readonly Json[], options: ListOptions = {}): Json {
  const filter = c.req.query("$filter")
  const conditions = filter ? parseFilter(filter) : []
  const matching = items.filter((item) => conditions.every((cond) => holds(item, cond)))
  const sorted = ordered(matching, c.req.query("$orderby"), options.defaultOrder)
  const top = pageSize(c, options.defaultPageSize ?? 10)
  const skip = Math.max(Number(c.req.query("$skip")) || 0, 0)
  const page = sorted.slice(skip, skip + top).map((item) => selected(item, c.req.query("$select")))
  const more = skip + top < sorted.length

  return {
    ...(options.context && { "@odata.context": options.context }),
    value: page,
    ...(more && { "@odata.nextLink": withParam(c.req.url, "$skip", String(skip + top)) }),
  }
}
