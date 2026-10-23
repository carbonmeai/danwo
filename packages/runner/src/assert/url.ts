/**
 * `expect(screen).toHaveURL(…)`: the active tab's address, checked again until it holds or time
 * runs out, as a step that verifies. A RegExp tests the whole address; a string is resolved
 * against the app's base URL (so `"/orders"` means the app's `/orders`) and must equal it.
 */
import { shown } from "../locate/describe.ts"
import type { LocateContext } from "../locate/locator.ts"
import type { TextMatch } from "../locate/types.ts"
import { type AssertOptions, ExpectationFailed } from "./matchers.ts"

/** Pauses between looks: quick at first, then every half second, as the locator checks do. */
const PAUSES_MS = [0, 50, 100, 250, 500]

/** The address `expected` stands for, `undefined` for a RegExp: a string resolved against `base`. */
export function expectedUrl(expected: TextMatch, base: string | undefined): string | undefined {
  if (typeof expected !== "string") return undefined

  try {
    return new URL(expected, base).href
  } catch {
    return expected
  }
}

/** Whether `href` is the address `expected` stands for. */
export function urlHolds(href: string, expected: TextMatch, base: string | undefined): boolean {
  return typeof expected === "string" ? href === expectedUrl(expected, base) : expected.test(href)
}

/** Checks the active tab's address until it is `expected` (or, negated, is not). */
export function checkUrl(
  context: LocateContext,
  expected: TextMatch,
  negate: boolean,
  options?: AssertOptions,
): Promise<void> {
  const resolved = expectedUrl(expected, context.baseUrl)
  const args = resolved === undefined ? shown(expected) : JSON.stringify(resolved)
  const api = `expect.${negate ? "not." : ""}toHaveURL`
  const label = `page ${negate ? "not." : ""}toHaveURL(${args})`
  const normal = options?.timeout ?? context.assertionTimeout
  const timeout = context.checkTimeout?.(api, label, normal) ?? normal

  return context.steps.run(
    "assertion",
    api,
    label,
    async () => {
      const deadline = Date.now() + timeout

      for (let round = 0; ; round++) {
        const href = context.page().url()

        if (urlHolds(href, expected, context.baseUrl) !== negate) return
        if (Date.now() >= deadline)
          throw new ExpectationFailed(
            `expect(screen).${negate ? "not." : ""}toHaveURL(${args}) failed after ${timeout} ms\n  expected: ${negate ? "not " : ""}${args}\n  received: ${JSON.stringify(href)}`,
          )

        const wait = Math.min(PAUSES_MS[round] ?? 500, Math.max(0, deadline - Date.now()))

        await new Promise((resolve) => setTimeout(resolve, wait))
      }
    },
    { verifies: true },
  )
}
