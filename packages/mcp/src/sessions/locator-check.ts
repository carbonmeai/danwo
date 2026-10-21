import { locatorCode, type ScreenQuery } from "@danwo/recorder"
/**
 * `check_locator`: whether a locator a test would use finds exactly one element on the live page.
 * One match gives the line to paste into the test; none or several say why a test using it would
 * fail, with the page's nearest elements as better locators.
 */
import { likeness } from "@danwo/runner"
import type { Locator, Page } from "playwright-core"

import {
  chainCode,
  emptyLink,
  type LocatorChain,
  locateChain,
  parseChain,
} from "./locator-chain.ts"

const MAX_SHOWN = 5
const MAX_LINE = 200

/** One element line of an accessibility snapshot: `- button "Pay" [ref=e4]`. */
interface TreeLine {
  readonly role: string
  readonly name: string
}

const LINE = /^\s*- (\w+)(?: "((?:[^"\\]|\\.)*)")?/

function treeLines(tree: string): TreeLine[] {
  return tree.split("\n").flatMap((line) => {
    const match = LINE.exec(line)

    return match?.[1] === undefined || match[2] === undefined
      ? []
      : [{ role: match[1], name: match[2].replace(/\\(.)/g, "$1") }]
  })
}

/** What the query's text is: the name for a role, the value otherwise. */
function wanted(query: ScreenQuery): string {
  const text = query.by === "role" ? query.name : query.value

  return text === undefined ? "" : String(text)
}

/** The page's elements most like what `query` looked for, as locators a test could use. */
function candidates(query: ScreenQuery, tree: string): string[] {
  const text = wanted(query)

  return treeLines(tree)
    .filter((line) => query.by !== "role" || line.role === query.value)
    .map((line) => ({ line, score: text === "" ? 0.5 : likeness(text, line.name) }))
    .filter(({ score }) => score > 0.3)
    .toSorted((a, b) => b.score - a.score)
    .slice(0, MAX_SHOWN)
    .map(({ line }) =>
      locatorCode({ by: "role", value: line.role, name: line.name, exact: undefined }),
    )
}

async function lineOf(locator: Locator, redact: (text: string) => string): Promise<string> {
  const snapshot = await locator.ariaSnapshot({ timeout: 2_000 }).catch(() => "")
  const first = redact(snapshot).split("\n")[0]?.trim() ?? ""
  const hidden = (await locator.isVisible()) ? "" : " (hidden)"

  return `${first.slice(0, MAX_LINE)}${hidden}`
}

async function testIds(page: Page): Promise<string[]> {
  const ids = await page
    .locator("[data-testid]")
    .evaluateAll((elements) => elements.map((element) => element.getAttribute("data-testid") ?? ""))

  return [...new Set(ids)].filter((id) => id !== "")
}

async function noMatch(page: Page, chain: LocatorChain, tree: string, code: string) {
  const query = chain.last
  const empty = await emptyLink(page, chain)
  const near =
    query.by === "testId"
      ? (await testIds(page))
          .toSorted((a, b) => likeness(wanted(query), b) - likeness(wanted(query), a))
          .slice(0, MAX_SHOWN)
          .map((id) => locatorCode({ by: "testId", value: id }))
      : candidates(query, tree)

  return [
    `${code} matches no element. A test using it would fail: the step waits for the element, then times out.`,
    ...(empty === undefined ? [] : [`already ${empty} matches none; fix that part first.`]),
    ...(near.length === 0 ? [] : ["nearest on the page:", ...near.map((line) => `  ${line}`)]),
  ]
}

async function manyMatches(
  locator: Locator,
  count: number,
  code: string,
  redact: (text: string) => string,
) {
  const lines: string[] = []

  for (let index = 0; index < Math.min(count, MAX_SHOWN); index++)
    lines.push(`  [${index}] ${await lineOf(locator.nth(index), redact)}`)

  return [
    `${code} matches ${count} elements. A test that clicks or fills with it would fail: an action needs exactly one element.`,
    ...lines,
    'narrow it: give the role\'s name, add exact: true, look inside a region or row (getByRole("region", { name: "Cart" }).getByRole(…)), or pick a locator that only this element has (a label, a test id).',
  ]
}

/** The answer to `check_locator` for `expression` on `page`, whose latest snapshot is `tree`. */
export async function checkLocator(
  page: Page,
  expression: string,
  tree: string,
  redact: (text: string) => string,
): Promise<string> {
  const chain = parseChain(expression)
  const code = chainCode(chain)
  const locator = locateChain(page, chain)
  const count = await locator.count()

  if (count === 0) return (await noMatch(page, chain, tree, code)).join("\n")
  if (count > 1) return (await manyMatches(locator, count, code, redact)).join("\n")

  return [
    `matches exactly 1 element: ${await lineOf(locator, redact)}`,
    `use in a test: ${code}`,
  ].join("\n")
}
