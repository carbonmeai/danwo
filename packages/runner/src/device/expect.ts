/**
 * `expect(locator)` on a device: checks that read the screen again until they hold or time runs
 * out, each recorded as a step that verifies. Any other value goes to the web `expect`'s value
 * matchers, so `expect(credits).toBe(500)` reads the same on every platform.
 */
import { type Expect, expect as valueExpect } from "../assert/expect.ts"
import type { AssertOptions, LocatorAssertions } from "../assert/matchers.ts"
import { shown } from "../locate/describe.ts"
import type { TextMatch } from "../locate/types.ts"
import { DanwoError } from "../support/codes.ts"
import { DeviceLocator } from "./locator.ts"
import { collapse, textOf } from "./match.ts"
import type { DeviceNode } from "./types.ts"

/** What one reading says about a check. */
interface Verdict {
  readonly pass: boolean
  readonly received: string
}

/** Reads one screen's matches and says whether the check holds. */
type Judge = (screen: readonly DeviceNode[], matched: readonly DeviceNode[]) => Verdict

/** A device check that did not hold before its timeout. */
class CheckFailed extends Error {
  readonly code = "EXPECTATION_FAILED"

  constructor(message: string) {
    super(message)
    this.name = "ExpectationFailed"
  }
}

const POLL_MS = 150

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** The single match's text, or why there is no single match. */
function single(
  screen: readonly DeviceNode[],
  matched: readonly DeviceNode[],
): { readonly node: DeviceNode; readonly text: string } | string {
  const [node] = matched

  if (node === undefined) return "no element"
  if (matched.length > 1) return `${matched.length} elements`

  return { node, text: textOf(screen, node) }
}

/** A check on the single match's text or value. */
function onSingle(read: (one: { node: DeviceNode; text: string }) => Verdict): Judge {
  return (screen, matched) => {
    const one = single(screen, matched)

    return typeof one === "string" ? { pass: false, received: one } : read(one)
  }
}

function whole(text: string, expected: TextMatch): boolean {
  return typeof expected === "string" ? text === collapse(expected) : expected.test(text)
}

function within(text: string, expected: TextMatch): boolean {
  return typeof expected === "string" ? text.includes(collapse(expected)) : expected.test(text)
}

const judges = {
  visible: ((_, matched) => ({
    pass: matched.length > 0,
    received: matched.length > 0 ? "visible" : "no element",
  })) satisfies Judge,
  hidden: ((_, matched) => ({
    pass: matched.length === 0,
    received: matched.length === 0 ? "hidden" : "visible",
  })) satisfies Judge,
  enabled: onSingle(({ node }) => ({
    pass: node.enabled,
    received: node.enabled ? "enabled" : "disabled",
  })),
  checked: onSingle(({ node }) => ({
    pass: node.checked === true,
    received: node.checked === true ? "checked" : "unchecked",
  })),
  text: (expected: TextMatch, contain: boolean) =>
    onSingle(({ text }) => ({
      pass: contain ? within(text, expected) : whole(text, expected),
      received: JSON.stringify(text),
    })),
  value: (expected: TextMatch) =>
    onSingle(({ node }) => ({
      pass: whole(collapse(node.value ?? ""), expected),
      received: JSON.stringify(node.value ?? ""),
    })),
  count:
    (expected: number): Judge =>
    (_, matched) => ({
      pass: matched.length === expected,
      received: String(matched.length),
    }),
}

/** Reads the screen until `judge` gives `!negate`, or throws with the last reading. */
async function hold(
  locator: DeviceLocator,
  call: string,
  judge: Judge,
  negate: boolean,
  timeout: number,
): Promise<void> {
  const deadline = Date.now() + timeout
  let last: Verdict = { pass: false, received: "nothing read yet" }

  for (;;) {
    const { reading, nodes } = await locator.matches()

    last = judge(reading.nodes, nodes)
    if (last.pass !== negate) return
    if (Date.now() >= deadline) break

    await sleep(POLL_MS)
  }

  throw new CheckFailed(`${call} failed after ${timeout} ms\n  received: ${last.received}`)
}

function unsupported(name: string): Promise<never> {
  return Promise.reject(
    new DanwoError("CONFIG_INVALID", `expect(...).${name} is not supported on Android yet`),
  )
}

/** The checks on a device locator; `negate` flips each one. */
function deviceAssertions(locator: DeviceLocator, negate = false): LocatorAssertions {
  const check = (name: string, args: string, judge: Judge, options?: AssertOptions) => {
    const not = negate ? "not." : ""
    const call = `expect(${locator.text}).${not}${name}(${args})`
    const api = `expect.${not}${name}`
    const label = `${locator.text} ${not}${name}(${args})`
    const normal = options?.timeout ?? locator.context.assertionTimeout
    const timeout = locator.context.checkTimeout?.(api, label, normal) ?? normal

    return locator.context.steps.run(
      "assertion",
      api,
      label,
      () => hold(locator, call, judge, negate, timeout),
      { verifies: true },
    )
  }

  return {
    get not() {
      return deviceAssertions(locator, !negate)
    },
    toBeVisible: (options) => check("toBeVisible", "", judges.visible, options),
    toBeHidden: (options) => check("toBeHidden", "", judges.hidden, options),
    toBeEnabled: (options) => check("toBeEnabled", "", judges.enabled, options),
    toBeDisabled: (options) =>
      check(
        "toBeDisabled",
        "",
        (screen, matched) => flip(judges.enabled(screen, matched)),
        options,
      ),
    toBeChecked: (options) => check("toBeChecked", "", judges.checked, options),
    toHaveText: (expected, options) =>
      check("toHaveText", shown(expected), judges.text(expected, false), options),
    toContainText: (expected, options) =>
      check("toContainText", shown(expected), judges.text(expected, true), options),
    toHaveValue: (expected, options) =>
      check("toHaveValue", shown(expected), judges.value(expected), options),
    toHaveCount: (expected, options) =>
      check("toHaveCount", String(expected), judges.count(expected), options),
    toHaveAttribute: () => unsupported("toHaveAttribute"),
    toHaveScreenshot: () => unsupported("toHaveScreenshot"),
  }
}

/** The opposite verdict on the same reading. */
function flip(verdict: Verdict): Verdict {
  return { pass: !verdict.pass, received: verdict.received }
}

/** The `expect` of device tests. */
// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- one runtime function serves every overload of Expect, which picks the assertions by the argument's type
export const deviceExpect = ((actual: unknown) => {
  if (actual instanceof DeviceLocator) return deviceAssertions(actual)

  return valueExpect(actual)
}) as Expect
