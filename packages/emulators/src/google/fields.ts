import { badRequest, isRecord } from "./api.ts"

/**
 * Partial responses: the `fields` parameter (`nextPageToken,files(id,name,owners/emailAddress)`)
 * picks which parts of a response come back. `*` keeps everything at its level; `a/b` and
 * `a(b,c)` select inside `a`, through arrays as well as objects.
 */

/** A parsed field mask: each selected key, with what to keep inside it (`true` keeps it whole). */
type Mask = Map<string, Mask | true>

function merge(mask: Mask, key: string, inner: Mask | true): void {
  const current = mask.get(key)

  if (current === true || inner === true) mask.set(key, true)
  else mask.set(key, current ? new Map([...current, ...inner]) : inner)
}

/** Reads one selection (`a`, `a/b` or `a(b,c)`) at `index`: its path, what it keeps, its end. */
function parseEntry(
  text: string,
  index: number,
): { path: string[]; inner: Mask | true; end: number } {
  const match = /^[\s,]*([\w*]+(?:\/[\w*]+)*)/.exec(text.slice(index))

  if (!match?.[1]) throw badRequest(`Invalid field selection ${text}`, "invalidParameter")

  const after = index + match[0].length

  if (text[after] !== "(") return { path: match[1].split("/"), inner: true, end: after }

  const nested = parseList(text, after + 1)

  return { path: match[1].split("/"), inner: nested.mask, end: nested.end + 1 }
}

/** Reads one comma-separated list from `text` at `start`, up to a `)` or the end. */
function parseList(text: string, start: number): { mask: Mask; end: number } {
  const mask: Mask = new Map()
  let index = start

  while (index < text.length && text[index] !== ")") {
    const entry = parseEntry(text, index)
    let inner = entry.inner

    for (const key of entry.path.slice(1).toReversed()) inner = new Map([[key, inner]])
    merge(mask, entry.path[0] ?? "", inner)
    index = entry.end
    while (text[index] === "," || text[index] === " ") index++
  }

  return { mask, end: index }
}

/** Parses a `fields` value. */
function parseFields(fields: string): Mask {
  return parseList(fields.trim(), 0).mask
}

/** Keeps the parts of `value` the mask selects. */
function select(value: unknown, mask: Mask): unknown {
  if (Array.isArray(value)) return value.map((item) => select(item, mask))
  if (!isRecord(value)) return value
  if (mask.has("*")) return value

  const picked: Record<string, unknown> = {}

  for (const [key, inner] of mask)
    if (key in value) picked[key] = inner === true ? value[key] : select(value[key], inner)

  return picked
}

/** `value` cut down to `fields`, or to `defaults` when the request named none. */
export function withFields(value: unknown, fields: string | undefined, defaults: string): unknown {
  return select(value, parseFields(fields ?? defaults))
}
