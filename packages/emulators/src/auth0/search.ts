import { isRecord } from "../json.ts"
import type { Auth0UserRecord } from "./entities.ts"
import { userView } from "./users.ts"

/**
 * The part of the user search query syntax the emulator understands: `field:value` terms (dotted
 * paths into `app_metadata` and `user_metadata` included), quoted values, `*` wildcards, `AND`,
 * `OR` and parentheses-free grouping. Terms side by side must all match; `OR` separates
 * alternatives. A bare word matches the email or the name.
 */
export class UnsupportedQuery extends Error {}

/** The value at a dotted path in a user's Management API view. */
function valueAt(user: Auth0UserRecord, path: string): unknown {
  let current: unknown = userView(user)

  for (const part of path.split(".")) current = isRecord(current) ? current[part] : undefined

  return current
}

function patternOf(raw: string): RegExp {
  const unquoted = raw.replace(/^"(.*)"$/, "$1")
  const escaped = unquoted.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replaceAll("*", ".*")

  return new RegExp(`^${escaped}$`, "i")
}

/** Whether a value (or, for lists, any of its items) matches the pattern. */
function matches(value: unknown, pattern: RegExp): boolean {
  if (Array.isArray(value)) return value.some((item) => matches(item, pattern))
  if (isRecord(value)) return Object.values(value).some((item) => matches(item, pattern))

  return (
    (typeof value === "string" || typeof value === "number" || typeof value === "boolean") &&
    pattern.test(String(value))
  )
}

/** One `field:value` term (or a bare word) as a test on a user. */
function term(raw: string): (user: Auth0UserRecord) => boolean {
  const colon = raw.indexOf(":")

  if (raw.includes("(") || raw.includes("["))
    throw new UnsupportedQuery(`unsupported query: ${raw}`)

  if (colon < 0) {
    const pattern = patternOf(`*${raw}*`)

    return (user) => pattern.test(user.email) || pattern.test(user.name)
  }

  const field = raw.slice(0, colon)
  const pattern = patternOf(raw.slice(colon + 1))
  const path = field === "identities.connection" ? "identities" : field

  return (user) => matches(valueAt(user, path), pattern)
}

/** The query's terms: words and `field:"quoted values"`, kept whole. */
function words(query: string): string[] {
  return query.match(/[^\s"]+:"[^"]*"|"[^"]*"|\S+/g) ?? []
}

/** A user filter for a search query; an empty query matches everyone. */
export function userQuery(query: string | undefined): (user: Auth0UserRecord) => boolean {
  if (query === undefined || query.trim() === "") return () => true

  const alternatives = query.split(/\s+OR\s+/).map((group) =>
    words(group)
      .filter((word) => word !== "AND")
      .map(term),
  )

  return (user) => alternatives.some((tests) => tests.every((test) => test(user)))
}
