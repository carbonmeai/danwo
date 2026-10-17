import type { Middleware } from "../http.ts"
import { isRecord } from "../json.ts"
import { readParams, stripeError } from "./helpers.ts"

/** Finds a formatted object by its Stripe id, or `undefined` if the id is unknown. */
export type Resolve = (id: string) => object | undefined

/** `expand` from the query (`expand[]=a`, `expand[0]=a`) or a form/JSON body (`expand[0]=a`). */
async function expandPaths(
  request: { url: string; method: string },
  body: () => Promise<Record<string, unknown>>,
): Promise<string[]> {
  const fromQuery = [...new URL(request.url).searchParams]
    .filter(([key]) => key === "expand" || /^expand\[\d*\]$/.test(key))
    .map(([, value]) => value)

  if (request.method === "GET" || request.method === "DELETE") return fromQuery
  const fromBody = (await body()).expand
  const listed = Array.isArray(fromBody) ? fromBody : typeof fromBody === "string" ? [fromBody] : []

  return [...fromQuery, ...listed.filter((p): p is string => typeof p === "string")]
}

/** The value at `key` with an id string replaced by its object; undefined if the id is unknown. */
function expandedValue(target: Record<string, unknown>, key: string, resolve: Resolve): unknown {
  const value = target[key]

  if (typeof value !== "string") return value

  const expanded = resolve(value)

  if (!expanded) return undefined
  target[key] = { ...expanded }

  return target[key]
}

/** Expands one dotted path in place. Returns false if the path does not name an expandable id. */
function expandPath(target: unknown, segments: string[], resolve: Resolve): boolean {
  const [head, ...rest] = segments

  if (head === undefined || !isRecord(target)) return false
  if (head === "data" && Array.isArray(target.data))
    return target.data.every((item) => expandPath(item, rest, resolve))

  return head in target && expandField(target, head, rest, resolve)
}

/** Expands `key` of `target`, then the rest of the path inside it. */
function expandField(
  target: Record<string, unknown>,
  key: string,
  rest: string[],
  resolve: Resolve,
): boolean {
  const value = expandedValue(target, key, resolve)

  if (value === undefined) return false
  if (rest.length === 0) return isRecord(value) || value === null

  return value === null || expandPath(value, rest, resolve)
}

/**
 * Applies Stripe's `expand` request option to every JSON response: each listed path's id is
 * replaced by the full object, through nested paths (`payment_intent.payment_method`) and lists
 * (`data.customer`). Up to four levels, as in Stripe.
 */
export function stripeExpand(resolve: Resolve): Middleware {
  return async (c, next) => {
    const response = await next()

    if (!c.req.path.startsWith("/v1/") || !response || !response.ok) return response

    const paths = await expandPaths(c.req, () => readParams(c))

    if (paths.length === 0) return response

    const body: unknown = await response.json()

    for (const path of paths) {
      const segments = path.split(".")

      if (segments.length > 4 || !expandPath(body, segments, resolve))
        return stripeError(
          c,
          400,
          "invalid_request_error",
          `This property cannot be expanded (${path}).`,
          undefined,
          "expand",
        )
    }

    return c.json(body, response.status)
  }
}
