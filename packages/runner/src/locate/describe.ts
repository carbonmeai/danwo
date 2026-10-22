/* How a locator is named in step labels and errors: the call a test would write to get it. */
import type {
  AriaRole,
  LongPressActionOptions,
  RoleOptions,
  TextMatch,
  TextOptions,
} from "./types.ts"

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

/** A filter's options as `filterCall` shows them: texts, and inner locators by their text. */
interface ShownFilter {
  readonly hasText?: TextMatch
  readonly hasNotText?: TextMatch
  readonly has?: { readonly text: string }
  readonly hasNot?: { readonly text: string }
}

/** `filter(hasText: "Ch", hasNot: getByRole("button"))`. */
export function filterCall(options: ShownFilter) {
  const texts = (["hasText", "hasNotText"] as const).flatMap((key) => {
    const match = options[key]

    return match === undefined ? [] : [`${key}: ${shown(match)}`]
  })
  const inner = (["has", "hasNot"] as const).flatMap((key) => {
    const locator = options[key]

    return locator === undefined ? [] : [`${key}: ${locator.text}`]
  })

  return call("filter", [...texts, ...inner])
}

/** A long press's arguments as a step label shows them: `durationMs: 600`, or none. */
export function longPressArgs(options: LongPressActionOptions | undefined): string {
  const shownOptions = [
    ...(options?.durationMs === undefined ? [] : [`durationMs: ${options.durationMs}`]),
    ...(options?.force === true ? ["force: true"] : []),
  ]

  return shownOptions.join(", ")
}
