/* How a locator is named in step labels and errors: the call a test would write to get it. */
import type { AriaRole, RoleOptions, TextMatch, TextOptions } from "./types.ts"

/** A text match as written in source: a quoted string or a regex literal. */
export function shown(match: TextMatch): string {
  return typeof match === "string" ? JSON.stringify(match) : String(match)
}

/** `method(a, b)`. */
function call(method: string, parts: readonly string[]): string {
  return `${method}(${parts.join(", ")})`
}

/** `getByRole("button", name: "Save")`. */
export function roleCall(role: AriaRole, options: RoleOptions = {}): string {
  const parts = [JSON.stringify(role)]

  if (options.name !== undefined) parts.push(`name: ${shown(options.name)}`)
  if (options.exact === true) parts.push("exact")

  return call("getByRole", parts)
}

/** `getByText("Apple")`, with `exact` when asked. */
export function textCall(method: string, match: TextMatch, options: TextOptions = {}): string {
  return call(method, options.exact === true ? [shown(match), "exact"] : [shown(match)])
}

/** `filter(hasText: "Ch")`. */
export function filterCall(options: { hasText?: TextMatch; has?: { readonly text: string } }) {
  const parts: string[] = []

  if (options.hasText !== undefined) parts.push(`hasText: ${shown(options.hasText)}`)
  if (options.has !== undefined) parts.push(`has: ${options.has.text}`)

  return call("filter", parts)
}
