/**
 * Locators as a test writes them: parsing a `screen.getBy*(…)` expression an agent typed, the
 * Playwright locator that matches the same elements danwo's screen does, and the code a test would
 * paste for a query.
 */
import type { Locator, Page } from "playwright-core"

import { isAriaRole } from "./jobs/roles.ts"

/** Text a query matches: a string (a substring unless exact), or a regular expression. */
export type TextMatch = string | RegExp

export type QueryKind = "role" | "text" | "label" | "placeholder" | "testId" | "altText" | "title"

/** How to find an element: one of the screen's `getBy*` queries. */
export interface ScreenQuery {
  readonly by: QueryKind
  /** The role for `role`; otherwise the text, label, placeholder, test id… */
  readonly value: TextMatch
  /** For `role`: the accessible name. */
  readonly name?: TextMatch | undefined
  readonly exact?: boolean | undefined
}

const KINDS: Readonly<Record<string, QueryKind>> = {
  Role: "role",
  Text: "text",
  Label: "label",
  Placeholder: "placeholder",
  TestId: "testId",
  AltText: "altText",
  Title: "title",
}

/** A string literal (double, single or back quotes) or a regular expression literal. */
const LITERAL = String.raw`"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\x60(?:[^\x60\\]|\\.)*\x60|\/(?:[^/\\\n]|\\.)+\/[dgimsuy]*`
const CALL = new RegExp(
  String.raw`^(?:screen\.)?getBy(\w+)\(\s*(${LITERAL})\s*(?:,\s*\{(.*)\})?\s*\)$`,
  "s",
)
const NAME = new RegExp(String.raw`\bname\s*:\s*(${LITERAL})`, "s")
const EXACT = /\bexact\s*:\s*(true|false)\b/

/** The value of a literal the pattern above matched. */
function literalValue(literal: string): TextMatch {
  if (literal.startsWith("/")) {
    const end = literal.lastIndexOf("/")

    return new RegExp(literal.slice(1, end), literal.slice(end + 1))
  }

  return literal.slice(1, -1).replace(/\\(.)/g, "$1")
}

/** The `{ name, exact }` options of a query, as far as they were given. */
function optionsOf(options: string): Pick<ScreenQuery, "name" | "exact"> {
  const name = NAME.exec(options)?.[1]
  const exact = EXACT.exec(options)?.[1]

  return {
    ...(name !== undefined && { name: literalValue(name) }),
    ...(exact !== undefined && { exact: exact === "true" }),
  }
}

/** Reads `getByRole("button", { name: "Pay" })`, with or without `screen.`, into a query. */
export function parseLocator(expression: string): ScreenQuery {
  const call = CALL.exec(expression.trim())
  const kind = KINDS[call?.[1] ?? ""]
  const value = call?.[2]

  if (value === undefined || kind === undefined) {
    throw new Error(
      `"${expression}" is not a locator: write one of the screen's queries, e.g. getByRole("button", { name: "Pay" }), getByLabel("Email"), getByText("Total"), getByTestId("checkout-pay")`,
    )
  }

  return { by: kind, value: literalValue(value), ...optionsOf(call?.[3] ?? "") }
}

function codeOf(match: TextMatch): string {
  return typeof match === "string" ? JSON.stringify(match) : String(match)
}

/** The locator a test would write for `query`, as code. */
export function locatorCode(query: ScreenQuery): string {
  const exact = query.exact === undefined ? "" : `exact: ${query.exact}`

  if (query.by === "role") {
    const options = [query.name === undefined ? "" : `name: ${codeOf(query.name)}`, exact]
      .filter((part) => part !== "")
      .join(", ")

    return `screen.getByRole(${codeOf(query.value)}${options === "" ? "" : `, { ${options} }`})`
  }

  const method = `getBy${query.by[0]?.toUpperCase() ?? ""}${query.by.slice(1)}`

  return `screen.${method}(${codeOf(query.value)}${exact === "" ? "" : `, { ${exact} }`})`
}

type Exact = { exact?: boolean }

function byRole(page: Page, query: ScreenQuery, exact: Exact): Locator {
  const role = String(query.value)

  if (!isAriaRole(role)) throw new Error(`"${role}" is not an ARIA role`)

  return page.getByRole(role, { ...exact, ...(query.name !== undefined && { name: query.name }) })
}

/** The text queries, by the name a test calls them with. */
const BY_TEXT: Readonly<
  Record<Exclude<QueryKind, "role">, (page: Page, value: TextMatch, exact: Exact) => Locator>
> = {
  text: (page, value, exact) => page.getByText(value, exact),
  label: (page, value, exact) => page.getByLabel(value, exact),
  placeholder: (page, value, exact) => page.getByPlaceholder(value, exact),
  testId: (page, value) => page.getByTestId(value),
  altText: (page, value, exact) => page.getByAltText(value, exact),
  title: (page, value, exact) => page.getByTitle(value, exact),
}

/** The Playwright locator behind `query`; danwo's screen queries match the same elements. */
export function locate(page: Page, query: ScreenQuery): Locator {
  const exact = query.exact === undefined ? {} : { exact: query.exact }

  return query.by === "role"
    ? byRole(page, query, exact)
    : BY_TEXT[query.by](page, query.value, exact)
}
