import { HIDE_POINTER } from "../browser/pointer.ts"
import { shown } from "../locate/describe.ts"
/*
 * `expect(locator)`: checks that wait for the page to get there, each recorded as a step that
 * verifies, and failing with the matcher, the locator, what was expected and what was on screen.
 */
import type { ElementLocator } from "../locate/locator.ts"
import type { TextMatch } from "../locate/types.ts"
import * as probes from "./probes.ts"
import type { Probe, Reading } from "./probes.ts"
import type { Subject } from "./screenshot.ts"
import { screenshotCheck, type VisualOptions } from "./visual.ts"

/** Options of one check. */
export interface AssertOptions {
  /** Milliseconds to keep checking; the session's assertion timeout by default. */
  readonly timeout?: number
}

/** A check of the element's state, such as `toBeVisible()`. */
type StateCheck = (options?: AssertOptions) => Promise<void>

/** A check against an expected value, such as `toHaveText("Saved")`. */
type ValueCheck<T> = (expected: T, options?: AssertOptions) => Promise<void>

/** What `expect(locator)` offers. */
export interface LocatorAssertions {
  /** The same checks, each holding when the plain one would not. */
  readonly not: LocatorAssertions
  readonly toBeVisible: StateCheck
  readonly toBeHidden: StateCheck
  readonly toBeEnabled: StateCheck
  readonly toBeDisabled: StateCheck
  readonly toBeChecked: StateCheck
  /** The whole text, whitespace collapsed; a RegExp tests it. */
  readonly toHaveText: ValueCheck<TextMatch>
  readonly toContainText: ValueCheck<TextMatch>
  readonly toHaveValue: ValueCheck<TextMatch>
  readonly toHaveCount: ValueCheck<number>
  /** The attribute is present, and equals `value` when one is given. */
  toHaveAttribute(name: string, value?: TextMatch, options?: AssertOptions): Promise<void>
  /**
   * The element looks like its baseline image (`__screenshots__/` next to the test), written on
   * the first run. `name` defaults to a number in order of the checks.
   */
  toHaveScreenshot(name?: string, options?: VisualOptions): Promise<void>
}

/** A check that did not hold before its timeout. */
class ExpectationFailed extends Error {
  readonly code = "EXPECTATION_FAILED"

  constructor(message: string) {
    super(message)
    this.name = "ExpectationFailed"
  }
}

/** Pauses between looks: quick at first, then every half second. */
const PAUSES_MS = [0, 50, 100, 250, 500]
/** No single look may take longer than this, so a slow read cannot eat the whole timeout. */
const MAX_LOOK_MS = 1_000

/** One matcher call: its name, its arguments as written, and how to read the page. */
interface Matcher {
  readonly name: string
  readonly args: string
  readonly probe: Probe
}

/** Waits `ms` milliseconds. */
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** One reading, never longer than the time left; an unreadable page reads as not holding. */
async function look(locator: ElementLocator, probe: Probe, deadline: number): Promise<Reading> {
  const budget = Math.max(50, Math.min(MAX_LOOK_MS, deadline - Date.now()))

  try {
    return await probe(locator.resolve(), budget)
  } catch (cause) {
    const message = cause instanceof Error ? (cause.message.split("\n")[0] ?? "") : String(cause)

    return { pass: false, received: `unreadable (${message})` }
  }
}

/** The error a check throws when time runs out, with what it last saw. */
function failure(
  locator: ElementLocator,
  check: Matcher,
  negate: boolean,
  ms: number,
  last: Reading,
) {
  const call = `expect(${locator.text}).${negate ? "not." : ""}${check.name}(${check.args})`
  const expected = `${negate ? "not " : ""}${check.args || check.name.replace(/^toBe/, "").toLowerCase()}`

  return new ExpectationFailed(
    `${call} failed after ${ms} ms\n  expected: ${expected}\n  received: ${last.received}`,
  )
}

/** Looks until the check holds (or, negated, stops holding) or the timeout passes. */
async function settle(locator: ElementLocator, check: Matcher, negate: boolean, timeout: number) {
  const deadline = Date.now() + timeout

  for (let round = 0; ; round++) {
    const reading = await look(locator, check.probe, deadline)

    if (!reading.ambiguous && reading.pass !== negate) return
    if (Date.now() >= deadline) throw failure(locator, check, negate, timeout, reading)

    await pause(Math.min(PAUSES_MS[round] ?? 500, Math.max(0, deadline - Date.now())))
  }
}

/** Runs a check as a step that verifies. */
function run(locator: ElementLocator, check: Matcher, negate: boolean, options?: AssertOptions) {
  const { steps, assertionTimeout, checkTimeout } = locator.session
  const api = `expect.${negate ? "not." : ""}${check.name}`
  const label = `${locator.text} ${negate ? "not." : ""}${check.name}(${check.args})`
  const normal = options?.timeout ?? assertionTimeout
  const timeout = checkTimeout?.(api, label, normal) ?? normal

  return steps.run("assertion", api, label, () => settle(locator, check, negate, timeout), {
    verifies: true,
  })
}

/** The checks on `locator`; `negate` flips each one. */
export function locatorAssertions(locator: ElementLocator, negate = false): LocatorAssertions {
  const check = (name: string, args: string, probe: Probe, options?: AssertOptions) =>
    run(locator, { name, args, probe }, negate, options)

  return {
    get not() {
      return locatorAssertions(locator, !negate)
    },
    toBeVisible: (options) => check("toBeVisible", "", probes.visible, options),
    toBeHidden: (options) => check("toBeHidden", "", probes.hidden, options),
    toBeEnabled: (options) => check("toBeEnabled", "", probes.enabled, options),
    toBeDisabled: (options) => check("toBeDisabled", "", probes.disabled, options),
    toBeChecked: (options) => check("toBeChecked", "", probes.checked, options),
    toHaveText: (expected, options) =>
      check("toHaveText", shown(expected), probes.text(expected, false), options),
    toContainText: (expected, options) =>
      check("toContainText", shown(expected), probes.text(expected, true), options),
    toHaveValue: (expected, options) =>
      check("toHaveValue", shown(expected), probes.value(expected), options),
    toHaveCount: (expected, options) =>
      check("toHaveCount", String(expected), probes.count(expected), options),
    toHaveAttribute: (name, value, options) =>
      check(
        "toHaveAttribute",
        value === undefined ? JSON.stringify(name) : `${JSON.stringify(name)}, ${shown(value)}`,
        probes.attribute(name, value),
        options,
      ),
    toHaveScreenshot: (name, options) => {
      if (negate) throw new TypeError("expect(...).not.toHaveScreenshot is not supported")

      return screenshotCheck(locator.session, elementPicture(locator), name, options)
    },
  }
}

/** Pictures of the element alone. */
function elementPicture(locator: ElementLocator): Subject {
  return {
    text: locator.text,
    take: (options) =>
      locator.resolve().screenshot({ ...pictureOptions(options), mask: [...options.mask] }),
  }
}

/** Playwright's screenshot options for a steady picture. */
export function pictureOptions(options: Parameters<Subject["take"]>[0]) {
  return {
    animations: options.animations,
    caret: "hide" as const,
    scale: "css" as const,
    style: HIDE_POINTER,
    timeout: options.timeout,
  }
}
