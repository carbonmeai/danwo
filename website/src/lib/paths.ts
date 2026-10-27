/** Addresses the pages link to that are derived from a docs page's slug. */

import { docsPath, type Lang } from "./i18n.ts"

/**
 * The markdown copy of a docs page, by its slug under `/docs` (`""` for the docs' home), in
 * `lang`.
 */
export function markdownPath(slug: string, lang: Lang = "en"): string {
  return docsPath(slug === "" ? "/docs/index.md" : `/docs/${slug}.md`, lang)
}

/** A docs page's slug from its markdown address's path segments, the inverse of `markdownPath`. */
export function slugsOfMarkdown(segments: readonly string[]): string[] {
  const slugs = [...segments]
  const last = slugs.pop()?.replace(/\.md$/, "")

  if (last !== undefined && !(slugs.length === 0 && last === "index")) slugs.push(last)

  return slugs
}

/**
 * Whether `href` on this site is a file (raw markdown or text) rather than a page, so the browser
 * loads it itself instead of the router looking for a page at that address.
 */
export function isFileAddress(href: string | undefined): boolean {
  return href !== undefined && href.startsWith("/") && /\.(md|txt)(#.*)?$/.test(href)
}
