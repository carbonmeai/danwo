/** Addresses the pages link to that are derived from a docs page's slug. */

/** The markdown copy of a docs page, by its slug under `/docs` (`""` for the docs' home). */
export function markdownPath(slug: string): string {
  return slug === "" ? "/docs/index.md" : `/docs/${slug}.md`
}

/** A docs page's slug from its markdown address's path segments, the inverse of `markdownPath`. */
export function slugsOfMarkdown(segments: readonly string[]): string[] {
  const slugs = [...segments]
  const last = slugs.pop()?.replace(/\.md$/, "")

  if (last !== undefined && !(slugs.length === 0 && last === "index")) slugs.push(last)

  return slugs
}
