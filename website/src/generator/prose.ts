/**
 * A readability check for docs pages: paragraphs packed with inline code. A run of names in a
 * sentence reads as a wall of chips; the style guide asks for a table instead.
 */

/** The most inline code spans a paragraph or list item may hold. */
const MAX_INLINE_CODE = 3

/** One paragraph that holds too much inline code: where it starts, how many spans, its opening. */
export interface DenseParagraph {
  readonly line: number
  readonly spans: number
  readonly text: string
}

/** The page's text with frontmatter and fenced code blocks blanked out, line numbers kept. */
function proseLines(markdown: string): string[] {
  const lines = markdown.split("\n")
  let fenced = false
  let front = lines[0] === "---"

  return lines.map((line, i) => {
    if (front) {
      if (i > 0 && line === "---") front = false

      return ""
    }

    if (/^\s*(```|~~~)/.test(line)) {
      fenced = !fenced

      return ""
    }

    return fenced ? "" : line
  })
}

/** Whether a line is outside running prose: a table row, a heading, a component tag or an import. */
function notProse(line: string): boolean {
  return /^\s*(\||#|<|import\s|export\s)/.test(line)
}

/** Whether a line starts a list item, which counts as a paragraph of its own. */
function startsItem(line: string): boolean {
  return /^\s*([-*+]|\d+\.)\s/.test(line)
}

/** How many inline code spans a paragraph's text holds. */
function codeSpans(text: string): number {
  return text.match(/`[^`\n]+`/g)?.length ?? 0
}

/** The paragraphs of the page's running prose, each with the line it starts on. */
function paragraphs(markdown: string): { line: number; text: string }[] {
  const found: { line: number; text: string }[] = []
  let current: { line: number; text: string } | undefined

  for (const [i, line] of proseLines(markdown).entries()) {
    if (line.trim() === "" || notProse(line)) {
      current = undefined
      continue
    }

    if (!current || startsItem(line)) {
      current = { line: i + 1, text: line }
      found.push(current)
    } else current.text += ` ${line.trim()}`
  }

  return found
}

/** The paragraphs and list items of a page with more than {@link MAX_INLINE_CODE} code spans. */
export function denseParagraphs(markdown: string): DenseParagraph[] {
  return paragraphs(markdown)
    .map(({ line, text }) => ({ line, spans: codeSpans(text), text: text.trim().slice(0, 80) }))
    .filter(({ spans }) => spans > MAX_INLINE_CODE)
}
