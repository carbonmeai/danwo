/**
 * Turns danwo's own markdown (guides, the README, the spec) into docs pages: a title and a
 * description for the page's frontmatter, and the body below them.
 */
import type { SpecEntry, SpecMember, SpecSection } from "./danwo.ts"

/** A page's text, split the way the docs show it. */
export interface PageText {
  readonly title: string
  readonly description: string
  readonly body: string
}

/** One paragraph on one line, for a frontmatter description. */
export function oneLine(text: string): string {
  return text.replaceAll(/\s+/g, " ").trim()
}

/**
 * A guide as a page: its `# Title` line becomes the title, the paragraph under it the
 * description, and everything after them the body.
 */
export function guidePage(markdown: string): PageText {
  const [heading = "", summary = "", ...rest] = markdown.trim().split(/\n\s*\n/)

  return {
    title: heading.replace(/^#\s*/, "").trim(),
    description: oneLine(summary),
    body: rest.join("\n\n"),
  }
}

/** The level of each line as a heading (0 for other lines), with fenced code never a heading. */
function headingLevels(lines: readonly string[]): number[] {
  let fenced = false

  return lines.map((line) => {
    if (line.startsWith("```")) fenced = !fenced

    return fenced ? 0 : (/^(#{1,6})\s/.exec(line)?.[1]?.length ?? 0)
  })
}

/** Where a heading's section is: its heading line, its level and the line after its last. */
interface Bounds {
  readonly start: number
  readonly level: number
  readonly end: number
}

/**
 * The bounds of the section under `heading`: up to the next heading of the same level or
 * higher. Throws when the heading is missing, so a renamed section fails the build instead of
 * leaving an empty page.
 */
function bounds(lines: readonly string[], heading: string): Bounds {
  const levels = headingLevels(lines)
  const start = lines.findIndex(
    (line, i) => (levels[i] ?? 0) > 0 && line.replace(/^#+\s*/, "").trim() === heading,
  )

  if (start === -1) throw new Error(`no "${heading}" heading to build a docs page from`)

  const level = levels[start] ?? 0
  const next = levels.findIndex((other, i) => i > start && other > 0 && other <= level)

  return { start, level, end: next === -1 ? lines.length : next }
}

/**
 * The text under `heading`, its subheadings raised so the section's own level becomes the
 * page's second level (`## `).
 */
export function section(markdown: string, heading: string): string {
  const lines = markdown.split("\n")
  const { start, level, end } = bounds(lines, heading)
  const levels = headingLevels(lines)

  return lines
    .slice(start + 1, end)
    .map((line, i) => ((levels[start + 1 + i] ?? 0) > 0 ? line.slice(level - 1) : line))
    .join("\n")
    .trim()
}

/** `markdown` without the sections under the headings named in `drop`. */
export function withoutSections(markdown: string, drop: readonly string[]): string {
  let lines = markdown.split("\n")

  for (const heading of drop) {
    const { start, end } = bounds(lines, heading)

    lines = [...lines.slice(0, start), ...lines.slice(end)]
  }

  return lines.join("\n").trim()
}

/** Markdown as plain text: code spans and links keep their words, the marks go. */
export function plainText(markdown: string): string {
  return markdown.replaceAll(/\[([^\]]+)\]\([^)]+\)/g, "$1").replaceAll("`", "")
}

/**
 * YAML frontmatter with every value quoted, so no title or description can break it. Titles and
 * descriptions are shown and indexed as plain text, so their markdown is dropped.
 */
export function frontmatter(fields: Readonly<Record<string, string | undefined>>): string {
  const lines = Object.entries(fields)
    .filter((entry): entry is [string, string] => entry[1] !== undefined)
    .map(([key, value]) => {
      const text = key === "title" || key === "description" ? plainText(value) : value

      return `${key}: ${JSON.stringify(text)}`
    })

  return `---\n${lines.join("\n")}\n---\n`
}

/** A member line: its signature (which names it) in code, then what it does. */
function memberLine(member: SpecMember): string {
  const code = member.signature || member.name

  return `- \`${code}\`${member.doc ? ` — ${oneLine(member.doc)}` : ""}`
}

/** The language a signature reads best in: shell for commands, TypeScript for the rest. */
function fence(entry: SpecEntry): string {
  return entry.kind === "command" ? "sh" : "ts"
}

/** One spec entry as a heading, its signature, its doc and its members. */
export function entryMarkdown(entry: SpecEntry, level = 3): string {
  const parts = [`${"#".repeat(level)} \`${entry.name}\``, `_${entry.kind}_`]

  if (entry.signature) parts.push(`\`\`\`${fence(entry)}\n${entry.signature}\n\`\`\``)
  if (entry.doc) parts.push(entry.doc)
  if (entry.members.length > 0) parts.push(entry.members.map(memberLine).join("\n"))

  return parts.join("\n\n")
}

/** A whole spec section: what it covers, then each entry. */
export function sectionMarkdown(spec: SpecSection, level = 3): string {
  return [spec.about, ...spec.entries.map((entry) => entryMarkdown(entry, level))].join("\n\n")
}
