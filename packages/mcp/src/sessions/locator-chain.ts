/**
 * Chained locators, as a test writes them: a query inside another (a button in a region, a cell
 * in a row) and the narrowing a locator offers, e.g.
 * `getByRole("region", { name: "Cart" }).getByRole("button", { name: "Remove" })` or
 * `getByRole("listitem").filter({ hasText: "Oats" }).first()`.
 */
import {
  isAriaRole,
  locatorCode,
  parseLocator,
  type QueryKind,
  type ScreenQuery,
  type TextMatch,
} from "@danwo/recorder"
import type { Locator, Page } from "playwright-core"

/** One link of a chain: a query inside what came before, or a narrowing of it. */
export type ChainStep =
  | { readonly kind: "query"; readonly query: ScreenQuery }
  | { readonly kind: "first" | "last" }
  | { readonly kind: "nth"; readonly index: number }
  | { readonly kind: "filter"; readonly hasText: TextMatch }

/** A parsed chain: always starts with a query. */
export interface LocatorChain {
  readonly steps: readonly ChainStep[]
  /** The query the chain ends on, for suggesting near matches. */
  readonly last: ScreenQuery
}

const QUOTES = new Set(['"', "'", "`"])
/** After these, a `/` starts a regular expression rather than dividing. */
const BEFORE_REGEX = new Set(["(", ",", ":", "{", "["])

/** Where a literal that starts at `start` ends (the index after it). */
function literalEnd(text: string, start: number): number {
  const close = text[start]
  let at = start + 1

  while (at < text.length && text[at] !== close) at += text[at] === "\\" ? 2 : 1

  if (close === "/") while (/[dgimsuy]/.test(text[at + 1] ?? "")) at += 1

  return at + 1
}

function startsLiteral(text: string, at: number, previous: string): boolean {
  const char = text[at] ?? ""

  return QUOTES.has(char) || (char === "/" && BEFORE_REGEX.has(previous))
}

/** How each bracket changes the nesting depth. */
const DEPTH: Readonly<Record<string, number>> = {
  "(": 1,
  "{": 1,
  "[": 1,
  ")": -1,
  "}": -1,
  "]": -1,
}

/** Splits `text` at the dots between calls, leaving dots inside literals and arguments alone. */
function links(text: string): string[] {
  const cuts: number[] = []
  let depth = 0
  let previous = ""
  let at = 0

  while (at < text.length) {
    const char = text[at] ?? ""

    if (startsLiteral(text, at, previous)) {
      at = literalEnd(text, at)
      previous = "x"
    } else {
      depth += DEPTH[char] ?? 0
      if (char === "." && depth === 0) cuts.push(at)
      previous = char.trim() === "" ? previous : char
      at += 1
    }
  }

  return [-1, ...cuts].map((cut, index) => text.slice(cut + 1, cuts[index] ?? text.length).trim())
}

const NTH = /^nth\(\s*(\d+)\s*\)$/
const FILTER = /^filter\(\s*\{\s*hasText\s*:\s*(.+?)\s*,?\s*\}\s*\)$/s

/** The text a `filter({ hasText })` takes, read the way a query's text is. */
function hasTextOf(literal: string): TextMatch {
  return parseLocator(`getByText(${literal})`).value
}

function stepOf(link: string, expression: string): ChainStep {
  if (link === "first()" || link === "last()")
    return { kind: link === "first()" ? "first" : "last" }

  const nth = NTH.exec(link)?.[1]

  if (nth !== undefined) return { kind: "nth", index: Number(nth) }

  const filter = FILTER.exec(link)?.[1]

  if (filter !== undefined) return { kind: "filter", hasText: hasTextOf(filter) }
  if (link.startsWith("getBy")) return { kind: "query", query: parseLocator(link) }

  throw new Error(
    `"${link}" in ${expression} is not part of a locator: chain getBy… queries, .first(), .last(), .nth(n) and .filter({ hasText })`,
  )
}

/** Reads a locator expression, one query or a chain of them, as a test writes it. */
export function parseChain(expression: string): LocatorChain {
  const parts = links(expression.trim())
  const body = parts[0] === "screen" ? parts.slice(1) : parts

  if (body.length <= 1) {
    const query = parseLocator(expression)

    return { steps: [{ kind: "query", query }], last: query }
  }

  const steps = body.map((link) => stepOf(link, expression))
  const head = steps[0]

  if (head?.kind !== "query")
    throw new Error(
      `${expression} must start with a query, e.g. getByRole("region", { name: "Cart" })`,
    )

  const last = steps.findLast((step) => step.kind === "query")

  return { steps, last: last?.kind === "query" ? last.query : head.query }
}

function textCode(match: TextMatch): string {
  return typeof match === "string" ? JSON.stringify(match) : String(match)
}

function stepCode(step: ChainStep, first: boolean): string {
  switch (step.kind) {
    case "query":
      return first ? locatorCode(step.query) : locatorCode(step.query).replace(/^screen/, "")
    case "nth":
      return `.nth(${step.index})`
    case "filter":
      return `.filter({ hasText: ${textCode(step.hasText)} })`
    default:
      return `.${step.kind}()`
  }
}

/** The chain as a test would write it, from `screen.`. */
export function chainCode(chain: LocatorChain): string {
  return chain.steps.map((step, index) => stepCode(step, index === 0)).join("")
}

type Exact = { exact?: boolean }

/** The text queries on a page or inside an element, by the name a test calls them with. */
const BY_TEXT: Readonly<
  Record<
    Exclude<QueryKind, "role">,
    (scope: Page | Locator, value: TextMatch, exact: Exact) => Locator
  >
> = {
  text: (scope, value, exact) => scope.getByText(value, exact),
  label: (scope, value, exact) => scope.getByLabel(value, exact),
  placeholder: (scope, value, exact) => scope.getByPlaceholder(value, exact),
  testId: (scope, value) => scope.getByTestId(value),
  altText: (scope, value, exact) => scope.getByAltText(value, exact),
  title: (scope, value, exact) => scope.getByTitle(value, exact),
}

/** `query` looked up inside `scope`, the way danwo's screen finds it. */
function within(scope: Page | Locator, query: ScreenQuery): Locator {
  const exact = query.exact === undefined ? {} : { exact: query.exact }

  if (query.by !== "role") return BY_TEXT[query.by](scope, query.value, exact)

  const role = String(query.value)

  if (!isAriaRole(role)) throw new Error(`"${role}" is not an ARIA role`)

  return scope.getByRole(role, { ...exact, ...(query.name !== undefined && { name: query.name }) })
}

function applyStep(scope: Locator, step: ChainStep): Locator {
  switch (step.kind) {
    case "query":
      return within(scope, step.query)
    case "first":
      return scope.first()
    case "last":
      return scope.last()
    case "nth":
      return scope.nth(step.index)
    default:
      return scope.filter({ hasText: step.hasText })
  }
}

/** The Playwright locator for `chain` on `page`; `upTo` stops after that many steps. */
export function locateChain(page: Page, chain: LocatorChain, upTo = chain.steps.length): Locator {
  const [head, ...rest] = chain.steps.slice(0, Math.max(upTo, 1))

  if (head?.kind !== "query") throw new Error("a chain starts with a query")

  return rest.reduce(applyStep, within(page, head.query))
}

/**
 * Why a chain that matches nothing does: the first link after which nothing matches, as code,
 * when that is before its end (`screen.getByRole("region", { name: "Cart" })` matches nothing).
 */
export async function emptyLink(page: Page, chain: LocatorChain): Promise<string | undefined> {
  for (let upTo = 1; upTo < chain.steps.length; upTo++) {
    if ((await locateChain(page, chain, upTo).count()) === 0)
      return chainCode({ steps: chain.steps.slice(0, upTo), last: chain.last })
  }

  return undefined
}
