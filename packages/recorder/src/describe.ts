/**
 * Finding the locator a test should use for an element someone just used: the first of a role
 * with its name, a label, a test id or its text that matches that element and nothing else on the
 * page, and that holds no value that changes between runs.
 */
import type { Page } from "playwright-core"

import { TAG_ATTRIBUTE } from "./events.ts"
import { locate, type ScreenQuery } from "./locators.ts"
import { isAriaRole } from "./roles.ts"

/** What the page says about an element, read once while it is still there. */
export interface ElementFacts {
  /** The role and accessible name the page's accessibility tree gives it. */
  readonly role: string | undefined
  readonly name: string | undefined
  readonly label: string | undefined
  readonly testId: string | undefined
  /** Its visible text, trimmed and short. */
  readonly text: string
  /** `input`, `select`, `textarea` or another tag name. */
  readonly tag: string
}

/** One element of the tree: `- button "Pay"`, or `- paragraph: Credits: 500`. */
const ARIA_LINE = /^\s*- (\w+)(?: "((?:[^"\\]|\\.)*)")?/

const VOLATILE = [
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i,
  /\d{5,}/,
  /\b\d{1,2}:\d{2}\b/,
  /\b\d{4}-\d{2}-\d{2}\b/,
  /\b[a-z]{2,10}_(?:[a-z]{2,10}_)?[A-Za-z0-9]{8,}\b/,
  /[A-Za-z0-9]{24,}/,
]

/** Whether `text` holds something that differs between runs, or one of `values`. */
export function isVolatile(text: string, values: readonly string[]): boolean {
  if (VOLATILE.some((pattern) => pattern.test(text))) return true

  return values.some((value) => value.length >= 3 && text.includes(value))
}

/**
 * A page of the app as a test opens it again: its path and the query parameters that stay the
 * same between runs. `/done?user=u1&session=cs_test_…` is `/done?user=u1`.
 */
export function stablePath(url: URL, values: readonly string[]): string {
  const kept = [...url.searchParams].filter(([, value]) => !isVolatile(value, values))
  const query = new URLSearchParams(kept).toString()

  return `${url.pathname}${query === "" ? "" : `?${query}`}`
}

function selector(tag: string): string {
  return `[${TAG_ATTRIBUTE}="${tag}"]`
}

/** The page's facts about the element named `tag`. */
export async function factsOf(page: Page, tag: string): Promise<ElementFacts> {
  const element = page.locator(selector(tag))
  const aria = ARIA_LINE.exec(await element.ariaSnapshot({ timeout: 2_000 }).catch(() => ""))
  const read = await element.evaluate((node) => {
    const control = node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement
    const label = control ? node.labels?.[0]?.innerText : undefined

    return {
      label: label ?? node.getAttribute("aria-label") ?? undefined,
      testId: node.getAttribute("data-testid") ?? undefined,
      text: node instanceof HTMLElement ? node.innerText.trim().slice(0, 120) : "",
      tag: node.localName,
    }
  })

  return { role: aria?.[1], name: aria?.[2]?.replace(/\\(.)/g, "$1"), ...read }
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")
}

/** A text query that leaves out the text's numbers: `/^Credits: /` for `Credits: 500`. */
function textQuery(text: string, values: readonly string[]): ScreenQuery | undefined {
  if (text === "" || text.length > 80 || text.includes("\n")) return undefined
  if (!/\d/.test(text)) return isVolatile(text, values) ? undefined : { by: "text", value: text }

  const prefix = text.slice(0, text.search(/\d/))

  if (prefix.trim().length < 3 || isVolatile(prefix, values)) return undefined

  return { by: "text", value: new RegExp(`^${escapeRegExp(prefix)}`) }
}

function roleQueries(facts: ElementFacts, values: readonly string[]): ScreenQuery[] {
  if (facts.role === undefined || !isAriaRole(facts.role)) return []
  if (facts.name === undefined || facts.name === "") return []
  if (isVolatile(facts.name, values)) return []

  return [
    { by: "role", value: facts.role, name: facts.name },
    { by: "role", value: facts.role, name: facts.name, exact: true },
  ]
}

/** The queries worth trying for an element, the most readable first. */
export function queriesFor(facts: ElementFacts, values: readonly string[]): ScreenQuery[] {
  const label =
    facts.label !== undefined && facts.label.trim() !== "" && !isVolatile(facts.label, values)
      ? [{ by: "label" as const, value: facts.label.trim() }]
      : []
  const testId = facts.testId === undefined ? [] : [{ by: "testId" as const, value: facts.testId }]
  const text = textQuery(facts.text, values)

  return [...roleQueries(facts, values), ...label, ...testId, ...(text ? [text] : [])]
}

/** Whether `query` finds exactly the element named `tag`, and no other. */
async function findsOnly(page: Page, query: ScreenQuery, tag: string): Promise<boolean> {
  const found = locate(page, query)

  if ((await found.count().catch(() => 0)) !== 1) return false

  return found.evaluate((node, name) => node.matches(name), selector(tag)).catch(() => false)
}

/** The first query that finds only the element named `tag`; undefined when none does. */
export async function chooseQuery(
  page: Page,
  tag: string,
  facts: ElementFacts,
  values: readonly string[],
): Promise<ScreenQuery | undefined> {
  for (const query of queriesFor(facts, values)) {
    if (await findsOnly(page, query, tag)) return query
  }

  return undefined
}
