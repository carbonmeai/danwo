/**
 * Small helpers for what tools answer with: short, plain lines an agent reads cheaply. Long text
 * is cut with a note of how much was left out; long lists keep their ends.
 */

/** `text` cut to `max` characters, noting what was cut. */
export function clip(text: string, max: number): string {
  const flat = text.trim()

  return flat.length <= max ? flat : `${flat.slice(0, max)}… (${flat.length - max} more chars)`
}

/** `text` on one line, cut to `max` characters. */
export function oneLine(text: string, max: number): string {
  return clip(text.replace(/\s*\n\s*/g, " ⏎ "), max)
}

export function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)} s`
}

/** `file:line`, or an empty string without a source. */
export function sourceText(source: { readonly file: string; readonly line: number } | undefined) {
  return source === undefined ? "" : `${source.file}:${source.line}`
}

/** The first `head` and last `tail` items, with a line saying how many were left out between. */
export function capped<T>(
  items: readonly T[],
  render: (item: T) => string,
  head: number,
  tail = 0,
): string[] {
  if (items.length <= head + tail) return items.map(render)

  const skipped = items.length - head - tail

  return [
    ...items.slice(0, head).map(render),
    `… ${skipped} more`,
    ...items.slice(items.length - tail).map(render),
  ]
}

/** Lines indented under a heading, or nothing when there are none. */
export function section(title: string, lines: readonly string[]): string[] {
  return lines.length === 0 ? [] : [title, ...lines.map((line) => `  ${line}`)]
}
