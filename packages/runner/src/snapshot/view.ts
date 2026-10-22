/**
 * The page as the agent reads it: Playwright's accessibility snapshot in "ai" mode, where every
 * element the agent may act on carries a ref (`[ref=e12]`). Refs belong to the latest snapshot of
 * the page, so the agent acts only on what it was just shown. Secret values are replaced before
 * the text leaves the session, and very large pages are then cut to fit the model that reads them
 * (see limit.ts).
 */
import type { Page } from "playwright-core"

import type { Tabs } from "../browser/tabs.ts"
import { iconIn, withIcons } from "./icons.ts"
import { DEFAULT_VIEW_CHARS } from "./limit.ts"

const SNAPSHOT_TIMEOUT_MS = 10_000

export interface PageView {
  readonly url: string
  readonly title: string
  /** The accessibility tree with refs, redacted and capped. */
  readonly tree: string
  /** When the tree was cut: how long it was, and how much of it the view kept. */
  readonly cut?: ViewCut
}

/** How much of a page's tree a view left out. */
export interface ViewCut {
  /** Characters the redacted tree had. */
  readonly chars: number
  /** Characters the view kept. */
  readonly kept: number
}

/**
 * Takes a fresh snapshot of `page`, which also makes its refs the ones actions resolve against.
 * A tree longer than `limit` characters is cut there, with a note.
 */
export async function viewPage(
  page: Page,
  redact: (text: string) => string,
  limit: number = DEFAULT_VIEW_CHARS,
): Promise<PageView> {
  /* Redacted before it is cut: a cut through a secret would leave its first characters behind. */
  const raw = await page.ariaSnapshot({ mode: "ai", timeout: SNAPSHOT_TIMEOUT_MS })
  const tree = redact(await withIcons(page, raw))
  const url = redact(page.url())
  const title = redact(await page.title())

  if (tree.length <= limit) return { url, title, tree }

  return {
    url,
    title,
    tree: `${tree.slice(0, limit)}\n… (page cut at ${limit} characters)`,
    cut: { chars: tree.length, kept: limit },
  }
}

/** The tabs line of a view, when more than one tab is open. */
function tabsLine(tabs: Tabs, redact: (text: string) => string): string {
  const open = tabs.list()

  if (open.length < 2) return ""

  const named = open.map((page, index) => {
    const active = page === tabs.page ? " (active)" : ""

    return `[${index}] ${redact(page.url())}${active}`
  })

  return `Tabs: ${named.join("  ")}\n`
}

/**
 * What the agent sees now: the active tab's page, or, while a dialog blocks it, the dialog. With
 * several tabs open, the view starts with the list of tabs. The page is cut at `limit` characters.
 */
export async function viewTabs(
  tabs: Tabs,
  redact: (text: string) => string,
  limit: number = DEFAULT_VIEW_CHARS,
): Promise<PageView> {
  const open = tabs.dialog

  if (open !== undefined) {
    const prompt =
      open.type === "prompt" ? ` (default text: ${JSON.stringify(open.defaultValue)})` : ""

    return {
      url: redact(tabs.page.url()),
      title: "",
      tree: `${tabsLine(tabs, redact)}A ${open.type} dialog blocks the page: ${JSON.stringify(redact(open.message))}${prompt}. Answer it with the dialog tool before anything else.`,
    }
  }

  const view = await viewPage(tabs.page, redact, limit)

  return { ...view, tree: `${tabsLine(tabs, redact)}${view.tree}` }
}

/** The view as one block of text for a prompt. */
export function viewText(view: PageView): string {
  return `URL: ${view.url}\nTitle: ${view.title}\n\n${view.tree}`
}

/** What a snapshot line says about the element behind a ref. */
export interface RefLine {
  readonly role: string
  /** The accessible name, when the line has one. */
  readonly name?: string
  /** Text after the colon, e.g. a paragraph's content. */
  readonly text?: string
  /** The icon an unnamed control shows, as its markup names it (see icons.ts). */
  readonly icon?: string
}

/** `- button "Add one" [disabled] [ref=e3]: tail` → role, name, tail. */
const LINE = /^\s*- ([a-z][\w-]*)(?: "((?:[^"\\]|\\.)*)")?(.*)$/

function unquote(raw: string): string {
  try {
    const parsed: unknown = JSON.parse(`"${raw}"`)

    return typeof parsed === "string" ? parsed : raw
  } catch {
    return raw
  }
}

/** The line of `tree` that carries `ref`, read as role, name and text. */
export function refLine(tree: string, ref: string): RefLine | undefined {
  const marker = `[ref=${ref}]`
  const line = tree.split("\n").find((candidate) => candidate.includes(marker))
  const match = line === undefined ? null : LINE.exec(line)

  if (match?.[1] === undefined) return undefined

  const rest = match[3] ?? ""
  const tail = /\]: (.+)$/.exec(rest)?.[1]
  const icon = iconIn(rest)

  return {
    role: match[1],
    ...(match[2] !== undefined && { name: unquote(match[2]) }),
    ...(tail !== undefined && { text: tail.trim() }),
    ...(icon !== undefined && { icon }),
  }
}

/** Roles that mark a part of the page a person would name: "the Billing form", "the main nav". */
const SECTION_ROLES = new Set([
  "navigation",
  "main",
  "form",
  "region",
  "dialog",
  "alertdialog",
  "banner",
  "contentinfo",
  "complementary",
  "search",
  "list",
  "table",
  "tabpanel",
  "article",
  "menu",
  "toolbar",
])

function indentOf(line: string): number {
  return line.length - line.trimStart().length
}

/** The part of the page line `index` sits in, as `role "name"`, or undefined at the top level. */
function sectionAt(lines: readonly string[], index: number): string | undefined {
  let indent = indentOf(lines[index] ?? "")

  for (let at = index - 1; at >= 0; at--) {
    const line = lines[at] ?? ""

    if (indentOf(line) >= indent) continue

    indent = indentOf(line)

    const match = LINE.exec(line)

    if (match?.[1] !== undefined && SECTION_ROLES.has(match[1]))
      return match[2] === undefined ? match[1] : `${match[1]} "${unquote(match[2])}"`
  }

  return undefined
}

/** The part of the page the element behind `ref` sits in, e.g. `form "Billing"`. */
export function refSection(tree: string, ref: string): string | undefined {
  const lines = tree.split("\n")
  const index = lines.findIndex((line) => line.includes(`[ref=${ref}]`))

  return index < 0 ? undefined : sectionAt(lines, index)
}

/** An element of the view: its ref, what its line says, and the part of the page it is in. */
export interface ViewElement extends RefLine {
  readonly ref: string
  readonly section?: string
}

/** Every element of `tree` that carries a ref. */
export function viewElements(tree: string): ViewElement[] {
  const lines = tree.split("\n")
  const elements: ViewElement[] = []

  for (const [index, line] of lines.entries()) {
    const ref = /\[ref=([a-z0-9]+)\]/.exec(line)?.[1]
    const read = ref === undefined ? undefined : refLine(line, ref)

    if (ref === undefined || read === undefined) continue

    const section = sectionAt(lines, index)

    elements.push({ ...read, ref, ...(section !== undefined && { section }) })
  }

  return elements
}
