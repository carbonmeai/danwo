/*
 * Turning a Playwright failure into one sentence about the locator: matched nothing, matched too
 * many, or found but not ready. The sentence names the locator the way the test wrote it.
 */
import { errors, type Locator as PlaywrightLocator } from "playwright-core"

import { DanwoError } from "../support/codes.ts"

const MAX_CANDIDATES = 5
const MAX_CANDIDATE_CHARS = 200
/** How long the explanation itself may look at the page. */
const PROBE_MS = 250

/** Why a locator failed: nothing matched, too much matched, not ready, or anything else. */
export type LocatorFailureCode =
  | "LOCATOR_NOT_FOUND"
  | "LOCATOR_AMBIGUOUS"
  | "LOCATOR_NOT_READY"
  | "LOCATOR_FAILED"

/** A locator failure, named the way the test wrote the locator. */
export class LocatorError extends Error {
  readonly code: LocatorFailureCode
  /**
   * Text of elements near what was asked for: the ones it matched, or others with its role. Not
   * yet redacted or cut; a record lists each through `candidateLine`.
   */
  readonly candidates: readonly string[]

  constructor(code: LocatorFailureCode, message: string, candidates: readonly string[] = []) {
    super(message)
    this.name = "LocatorError"
    this.code = code
    this.candidates = candidates
  }
}

/** The action or read that failed, and on what. */
export interface Attempted {
  /** `locator.click`, `locator.textContent`… */
  readonly api: string
  /** The locator as the test wrote it. */
  readonly text: string
  readonly timeout: number
  readonly target: PlaywrightLocator
  /** Elements worth listing when nothing matched, e.g. everything with the asked role. */
  readonly nearby?: PlaywrightLocator
  /** Each call of the locator's chain with what it matches so far, from the first `getBy*`. */
  readonly chain?: readonly { readonly call: string; readonly target: PlaywrightLocator }[]
}

/**
 * How many elements each call of a chain left, as `; by step: getByRole("listitem") 3,
 * .filter(hasText: "Kiwi") 0`, so a failure shows which call lost the element. Empty for a
 * locator of one call, whose count the message already gives.
 */
export async function stepCounts(
  chain: readonly { readonly call: string; readonly target: PlaywrightLocator }[] | undefined,
): Promise<string> {
  if (chain === undefined || chain.length < 2) return ""

  const counts = await Promise.all(
    chain.map(async (step) => {
      const count = await step.target.count().catch(() => undefined)

      return `${step.call} ${count ?? "?"}`
    }),
  )

  return `; by step: ${counts.join(", ")}`
}

/** The first line of a multi-line error message. */
function firstLine(message: string): string {
  return (message.split("\n")[0] ?? message).trim()
}

/**
 * Up to five whitespace-collapsed texts of what `locator` matches, whole: they are cut to length
 * only once redacted (`candidateLine`), so a cut never leaves part of a secret behind.
 */
async function texts(locator: PlaywrightLocator | undefined): Promise<string[]> {
  if (locator === undefined) return []

  const all = await locator.allInnerTexts().catch(() => [])

  return all
    .map((text) => text.replace(/\s+/g, " ").trim())
    .filter((text) => text.length > 0)
    .slice(0, MAX_CANDIDATES)
}

/** A candidate as a record lists it: redacted by `redact`, then cut to a short line. */
export function candidateLine(text: string, redact: (text: string) => string): string {
  return redact(text).slice(0, MAX_CANDIDATE_CHARS)
}

/** A single match that never became actionable: disabled, hidden, or just slow. */
async function notReady(attempt: Attempted): Promise<LocatorError> {
  const { api, text, timeout, target } = attempt
  const disabled = await target.isDisabled({ timeout: PROBE_MS }).catch(() => false)

  if (disabled) return new LocatorError("LOCATOR_NOT_READY", `${api}: ${text} is disabled`)

  const visible = await target.isVisible().catch(() => true)
  const why = visible ? `was not ready within ${timeout} ms` : "is not visible"

  return new LocatorError("LOCATOR_NOT_READY", `${api}: ${text} ${why}`)
}

/** The error to throw for `cause`, which Playwright raised while working on `attempt.target`. */
export async function explain(attempt: Attempted, cause: unknown): Promise<Error> {
  if (cause instanceof LocatorError || cause instanceof DanwoError) return cause

  const { api, text, timeout, target } = attempt
  const count = await target.count().catch(() => undefined)

  if (count === 0) {
    const within = cause instanceof errors.TimeoutError ? ` within ${timeout} ms` : ""

    return new LocatorError(
      "LOCATOR_NOT_FOUND",
      `${api}: ${text} matched nothing${within}${await stepCounts(attempt.chain)}`,
      await texts(attempt.nearby),
    )
  }

  if (count !== undefined && count > 1)
    return new LocatorError(
      "LOCATOR_AMBIGUOUS",
      `${api}: ${text} matched ${count} elements; it needs exactly one (use first(), nth() or filter())${await stepCounts(attempt.chain)}`,
      await texts(target),
    )

  if (cause instanceof errors.TimeoutError) return notReady(attempt)

  const message = cause instanceof Error ? firstLine(cause.message) : String(cause)

  return new LocatorError("LOCATOR_FAILED", `${api}: ${text}: ${message}`)
}
