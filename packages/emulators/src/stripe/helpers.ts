import { randomInt } from "node:crypto"

import type { Context } from "../http.ts"

const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"

/** Random letters and digits, always including at least two digits, as Stripe's ids do. */
function randomBody(length: number): string {
  for (;;) {
    let body = ""

    for (let i = 0; i < length; i++) body += BASE62[randomInt(BASE62.length)]
    if ((body.match(/\d/g) ?? []).length >= 2) return body
  }
}

/** A new id such as `cus_9fA2…`; Checkout Sessions get Stripe's `cs_test_` form. */
export function newId(prefix: string, length = 24): string {
  return prefix === "cs" ? `cs_test_${randomBody(58)}` : `${prefix}_${randomBody(length)}`
}

/** Unix seconds for a clock reading. */
export function unix(date: Date): number {
  return Math.floor(date.getTime() / 1000)
}

type ErrorType = "invalid_request_error" | "card_error" | "api_error" | "idempotency_error"

/** Stripe's error body: `{ error: { type, message, code?, param? } }`. */
export function stripeError(
  c: Context,
  status: number,
  type: ErrorType,
  message: string,
  code?: string,
  param?: string,
): Response {
  return c.json(
    {
      error: {
        type,
        message,
        ...(code !== undefined && { code }),
        ...(param !== undefined && { param }),
      },
    },
    status,
  )
}

/** The 404 Stripe answers for an unknown id, e.g. `No such customer: 'cus_123'`. */
export function noSuch(c: Context, what: string, id: string, param?: string): Response {
  return stripeError(
    c,
    404,
    "invalid_request_error",
    `No such ${what}: '${id}'`,
    "resource_missing",
    param,
  )
}

/** A 400 for a missing or malformed parameter. */
export function badParam(c: Context, param: string, message?: string): Response {
  return stripeError(
    c,
    400,
    "invalid_request_error",
    message ?? `Missing required param: ${param}.`,
    message === undefined ? "parameter_missing" : "parameter_invalid",
    param,
  )
}

type Tree = Record<string, unknown>

/** `a[b][0][c]` to `["a", "b", "0", "c"]`. */
function keyPath(key: string): string[] {
  const head = key.split("[", 1)[0] ?? key
  const rest = [...key.slice(head.length).matchAll(/\[([^\]]*)\]/g)].map((m) => m[1] ?? "")

  return [head, ...rest]
}

/** An empty container for the key after this one: a list for `[]` or an index, else an object. */
function containerFor(next: string): Tree {
  return (next === "" || /^\d+$/.test(next) ? [] : {}) as Tree
}

/** Puts `value` at `path`, creating lists and objects along the way. */
function place(root: Tree, path: readonly string[], value: string): void {
  let node = root

  for (const [index, key] of path.entries()) {
    const slot = Array.isArray(node) && key === "" ? String(node.length) : key
    const next = path[index + 1]

    if (next === undefined) node[slot] = value
    else node = (node[slot] ??= containerFor(next)) as Tree
  }
}

/** Form pairs (`metadata[plan]=pro`, `expand[]=x`) as a nested object. */
function nestPairs(pairs: Iterable<[string, string]>): Tree {
  const root: Tree = {}

  for (const [key, value] of pairs) place(root, keyPath(key), value)

  return root
}

/**
 * The parameters of a Stripe request: the form body of a write, or the query of a read.
 * Arrays sent with indexes come back as arrays.
 */
export async function readParams(c: Context): Promise<Tree> {
  if (c.req.method === "GET" || c.req.method === "DELETE")
    return nestPairs(new URL(c.req.url).searchParams)

  const type = c.req.header("content-type") ?? ""

  if (type.includes("application/json")) {
    const parsed: unknown = JSON.parse((await c.req.text()) || "{}")

    return asRecord(parsed) ?? {}
  }

  return nestPairs(new URLSearchParams(await c.req.text()))
}

export function asRecord(value: unknown): Tree | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Tree)
    : undefined
}

/** A text parameter; an empty string counts as given. */
export function text(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined
}

/** A text parameter, or `null` when it is absent. */
export function textOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null
}

/** Several optional text parameters at once, renamed: `{ successUrl: "success_url" }`. */
export function textsOf<K extends string>(
  params: Tree,
  names: Readonly<Record<K, string>>,
): Record<K, string | null> {
  const entries = Object.entries<string>(names).map(([key, name]) => [
    key,
    textOrNull(params[name]),
  ])

  return Object.fromEntries(entries) as Record<K, string | null>
}

/** For each of `keys` sent in `params`, its new text; an empty string clears it to `null`. */
export function clearableTexts<K extends string>(
  params: Tree,
  keys: readonly K[],
): Partial<Record<K, string | null>> {
  const changes: Partial<Record<K, string | null>> = {}

  for (const key of keys) if (params[key] !== undefined) changes[key] = text(params[key]) || null

  return changes
}

/** A whole-number parameter, from its form text. */
export function integer(value: unknown): number | undefined {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN

  return Number.isInteger(parsed) ? parsed : undefined
}

/** A boolean parameter: `true`/`false` as form text. */
export function flag(value: unknown): boolean | undefined {
  if (value === true || value === "true") return true
  if (value === false || value === "false") return false

  return undefined
}

/** A list parameter, from `x[0]=a` or `x[]=a`. */
export function items(value: unknown): unknown[] {
  if (Array.isArray(value)) return value.filter((item) => item !== undefined)

  return value === undefined ? [] : [value]
}

/** `metadata[...]` as a string map. */
export function metadataOf(value: unknown): Record<string, string> | undefined {
  const record = asRecord(value)

  if (!record) return undefined

  return Object.fromEntries(
    Object.entries(record).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  )
}

/** Stripe's metadata update rule: keys are merged, and an empty value removes a key. */
export function mergeMetadata(
  current: Record<string, string>,
  update: Record<string, string> | undefined,
): Record<string, string> {
  if (!update) return current

  const merged = { ...current, ...update }

  for (const [key, value] of Object.entries(update)) if (value === "") delete merged[key]

  return merged
}

const DEFAULT_LIMIT = 10
const MAX_LIMIT = 100

/** One page of `objects` (oldest first) as Stripe lists them: newest first, by cursor. */
export function listPage<T extends { id: string }>(
  c: Context,
  objects: readonly T[],
  url: string,
): Response {
  const newest = [...objects].reverse()
  const limit = Math.min(Math.max(integer(c.req.query("limit")) ?? DEFAULT_LIMIT, 1), MAX_LIMIT)
  const page = pageOf(newest, limit, c.req.query("starting_after"), c.req.query("ending_before"))

  return c.json({ object: "list", ...page, url })
}

/** The objects after `after` (or before `before`) in newest-first order, `limit` at most. */
function pageOf<T extends { id: string }>(
  newest: readonly T[],
  limit: number,
  after: string | undefined,
  before: string | undefined,
): { data: T[]; has_more: boolean } {
  if (before) {
    const end = Math.max(
      0,
      newest.findIndex((o) => o.id === before),
    )
    const start = Math.max(0, end - limit)

    return { data: newest.slice(start, end), has_more: start > 0 }
  }

  const from = after ? newest.findIndex((o) => o.id === after) + 1 : 0
  const rest = newest.slice(from)

  return { data: rest.slice(0, limit), has_more: rest.length > limit }
}
