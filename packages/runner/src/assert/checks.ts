/**
 * An `expect` whose checks of plain values are steps of the flight record: `expect(count, "messages
 * in Bob's Inbox").toBe(1)` in an invariant shows as a check with what it got and what it wanted,
 * passed or failed. Locator and page checks already record themselves and pass through unchanged.
 */
import { ElementLocator, PageScreen } from "../locate/locator.ts"
import { preview } from "../record/steps.ts"
import type { CheckValues, StepRecorder } from "../record/steps.ts"
import type { Expect } from "./expect.ts"

/** Chains that change what the next matcher means, kept in the step's label. */
const MODIFIERS = new Set(["not", "resolves", "rejects"])

/** The words of a check as written: `expect(<subject>)` followed by its chain. */
interface Wording {
  readonly subject: string
  readonly actual: unknown
  readonly chain: readonly string[]
}

/** A matcher is a function of its arguments; its exact signature is the assertion's own. */
function isMatcher(value: unknown): value is (...args: unknown[]) => unknown {
  return typeof value === "function"
}

/** The argument list of a matcher call, each value previewed. */
function argumentsOf(args: readonly unknown[]): string {
  return args.map((arg) => preview(arg)).join(", ")
}

/** Wraps a matcher call so it runs as a recorded check. */
function recordedMatcher(
  log: StepRecorder,
  wording: Wording,
  name: string,
  matcher: (...args: unknown[]) => unknown,
  target: object,
) {
  return (...args: unknown[]) => {
    const path = [...wording.chain, name].join(".")
    const label = `expect(${wording.subject}).${path}(${argumentsOf(args)})`
    const values: CheckValues = {
      actual: preview(wording.actual),
      ...(args.length > 0 && { expected: argumentsOf(args) }),
    }

    return log.check(`expect.${name}`, label, values, () => matcher.apply(target, args))
  }
}

/** An assertion whose matchers record themselves, keeping the chain (`not`, `resolves`) seen so far. */
function recordedAssertion<A extends object>(assertion: A, log: StepRecorder, wording: Wording): A {
  return new Proxy(assertion, {
    get(target, property, receiver) {
      const value: unknown = Reflect.get(target, property, receiver)

      if (typeof property !== "string") return value

      if (MODIFIERS.has(property) && typeof value === "object" && value !== null) {
        return recordedAssertion(value, log, { ...wording, chain: [...wording.chain, property] })
      }

      return isMatcher(value) && property.startsWith("to")
        ? recordedMatcher(log, wording, property, value, target)
        : value
    },
  })
}

/** `base`, with every check of a plain value recorded to `log` as a step. */
export function recordingExpect(base: Expect, log: StepRecorder): Expect {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- one runtime function serves every overload of Expect, as the base does
  return ((actual: unknown, message?: string) => {
    if (actual instanceof ElementLocator || actual instanceof PageScreen) return base(actual)

    const assertion: object = base(actual, message)

    return recordedAssertion(assertion, log, {
      subject: message ?? preview(actual),
      actual,
      chain: [],
    })
  }) as Expect
}
