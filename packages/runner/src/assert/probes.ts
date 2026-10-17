/*
 * One look at a locator's state: did the check hold, and what was on screen. Probes never wait for
 * the page; the poll in matchers.ts calls them again until the check holds or time runs out.
 */
import type { Locator as PlaywrightLocator } from "playwright-core"

import type { TextMatch } from "../locate/types.ts"

/** The result of one look. */
export interface Reading {
  readonly pass: boolean
  /** What the page showed, for the failure message. */
  readonly received: string
  /** The locator matched several elements where the check reads one; it fails either way. */
  readonly ambiguous?: boolean
}

/** Reads a locator once, giving up after `budget` milliseconds. */
export type Probe = (target: PlaywrightLocator, budget: number) => Promise<Reading>

/** Text as a reader sees it: runs of whitespace are one space, and the ends are trimmed. */
function normalized(text: string): string {
  return text.replace(/\s+/g, " ").trim()
}

/** Whether `actual` matches `expected` whole, or contains it when `partial`. */
function textHolds(actual: string, expected: TextMatch, partial: boolean): boolean {
  if (typeof expected !== "string") return expected.test(actual)

  const wanted = normalized(expected)

  return partial ? actual.includes(wanted) : actual === wanted
}

/** Runs `read` on the single matched element; none or several is a reading of its own. */
function single(read: Probe): Probe {
  return async (target, budget) => {
    const count = await target.count()

    if (count === 0) return { pass: false, received: "no element" }
    if (count > 1) return { pass: false, received: `${count} elements`, ambiguous: true }

    return read(target, budget)
  }
}

/** A probe of a yes/no state of the single matched element. */
function state(
  read: (target: PlaywrightLocator, budget: number) => Promise<boolean>,
  yes: string,
  no: string,
): Probe {
  return single(async (target, budget) => {
    const holds = await read(target, budget)

    return { pass: holds, received: holds ? yes : no }
  })
}

/** The element is visible. */
export const visible: Probe = state((target) => target.isVisible(), "visible", "hidden")

/** Nothing matches, or the element is hidden. */
export const hidden: Probe = async (target, budget) =>
  (await target.count()) === 0
    ? { pass: true, received: "no element" }
    : state((t) => t.isHidden(), "hidden", "visible")(target, budget)

/** The element is enabled. */
export const enabled = state((t, budget) => t.isEnabled({ timeout: budget }), "enabled", "disabled")

/** The element is disabled. */
export const disabled = state(
  (t, budget) => t.isDisabled({ timeout: budget }),
  "disabled",
  "enabled",
)

/** The checkbox or radio is checked. */
export const checked = state(
  (t, budget) => t.isChecked({ timeout: budget }),
  "checked",
  "unchecked",
)

/** The element's text equals (or contains) `expected`. */
export function text(expected: TextMatch, partial: boolean): Probe {
  return single(async (target, budget) => {
    const actual = normalized((await target.textContent({ timeout: budget })) ?? "")

    return { pass: textHolds(actual, expected, partial), received: JSON.stringify(actual) }
  })
}

/** The field's value equals `expected`. */
export function value(expected: TextMatch): Probe {
  return single(async (target, budget) => {
    const actual = await target.inputValue({ timeout: budget })

    return { pass: textHolds(actual, expected, false), received: JSON.stringify(actual) }
  })
}

/** The locator matches `expected` elements. */
export function count(expected: number): Probe {
  return async (target) => {
    const actual = await target.count()

    return { pass: actual === expected, received: String(actual) }
  }
}

/** The attribute is present, and equals `expected` when given. */
export function attribute(name: string, expected: TextMatch | undefined): Probe {
  return single(async (target, budget) => {
    const actual = await target.getAttribute(name, { timeout: budget })
    const pass = actual !== null && (expected === undefined || textHolds(actual, expected, false))

    return { pass, received: actual === null ? "no such attribute" : JSON.stringify(actual) }
  })
}
