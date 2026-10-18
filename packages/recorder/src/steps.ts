/**
 * A recording as steps, and the test body they become: each action as a locator line followed by
 * what it caused behind the app, each assertion as an `expect`, each note as a comment.
 */
import type { ScreenQuery } from "./locators.ts"

/** Where the backend's history stood when a step began: how many calls and deliveries. */
export interface Mark {
  readonly calls: number
  readonly deliveries: number
}

/** A step that can cause provider calls and webhooks: opening a page, or acting on an element. */
export interface ActionStep {
  readonly kind: "action"
  readonly line: string
  readonly mark: Mark
  /** The element it acted on, for typing that goes on in the same field. */
  readonly tag?: string | undefined
  /** Set when this step typed into a field, so later keystrokes replace its line. */
  readonly typing?: boolean | undefined
}

/** What an assertion saw when it was recorded. */
export interface Observation {
  readonly query: ScreenQuery | undefined
  readonly text: string
  /** The app page it was made on, as a path; undefined on another site (a provider's page). */
  readonly path: string | undefined
}

export interface AssertStep {
  readonly kind: "assert"
  readonly line: string
  readonly observed: Observation
}

export interface NoteStep {
  readonly kind: "note"
  readonly text: string
}

export type Step = ActionStep | AssertStep | NoteStep

/** One step with what happened behind the app while it was the latest. */
export interface ResolvedStep {
  readonly step: Step
  /** Provider calls and webhook deliveries it caused, in order, each listed once. */
  readonly effects: readonly string[]
}

/** The body's lines: each step, and after an action, what it caused. */
export function bodyLines(steps: readonly ResolvedStep[]): string[] {
  return steps.flatMap(({ step, effects }) => {
    if (step.kind === "note") return [`/* ${step.text.replace(/\*\//g, "* /")} */`]
    if (step.kind === "assert" || effects.length === 0) return [step.line]

    return [step.line, `// → ${effects.join(" · ")}`]
  })
}

/** The fixtures a body or invariant uses, in the order a test lists them. */
export function fixturesUsed(lines: readonly string[], known: readonly string[]): string[] {
  const code = lines.join("\n")

  return known.filter((name) => new RegExp(`\\b${name}\\b`).test(code))
}
