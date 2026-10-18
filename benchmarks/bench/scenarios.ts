/**
 * What the benchmark measures: the scenarios, the three ways each is written, and which scenario
 * each planted bug must make fail.
 */
import { type Bug, PROVIDER_BUGS } from "../app/bugs.ts"

export const SCENARIOS = [
  "signup",
  "checkout",
  "orders",
  "settings",
  "products",
  "projects",
  "upload",
  "newsletter",
  "approve",
  "team",
  "report",
] as const

export type Scenario = (typeof SCENARIOS)[number]

/** Locators only (no model), the agent alone, and the two mixed. */
export const STYLES = ["locators", "agent", "mixed"] as const

export type Style = (typeof STYLES)[number]

/** The test file each style lives in, relative to the benchmark's folder. */
export function fileOf(style: Style): string {
  return `tests/${style}.danwo.ts`
}

/** A test's title: `<scenario> [<style>]`. */
export function titleOf(scenario: Scenario, style: Style): string {
  return `${scenario} [${style}]`
}

/**
 * Bugs a plain `danwo test` run must catch, with the scenario that has to fail. Fulfilling an
 * order on the browser's return is visible without any fault: the payment invariant sees an order
 * paid with no event behind it.
 */
export const TEST_BUGS: readonly { readonly bug: Bug; readonly scenario: Scenario }[] = [
  { bug: "wrong-total", scenario: "checkout" },
  { bug: "dead-second-click", scenario: "products" },
  { bug: "hidden-validation", scenario: "settings" },
  { bug: "fulfil-on-redirect", scenario: "checkout" },
]

/** Bugs only faults behind the app expose, each run under `danwo matrix` on the checkout test. */
export const MATRIX_BUGS: readonly Bug[] = PROVIDER_BUGS

/** The test `danwo matrix` breaks for the provider bugs. */
export const MATRIX_TEST = { style: "locators", scenario: "checkout" } as const satisfies {
  readonly style: Style
  readonly scenario: Scenario
}
