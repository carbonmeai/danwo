/**
 * Every address the static build writes. Pages linked from other pages are found by crawling;
 * these are the ones nothing links to: the markdown copy of each docs page, the files for search
 * engines and language models, and the search index.
 */
import { readdirSync } from "node:fs"
import { join } from "node:path"

import { docsPath, type Lang } from "../lib/i18n.ts"
import { markdownPath } from "../lib/paths.ts"
import { pageSlug, WEBSITE } from "./generate.ts"
import { plannedPages } from "./plan.ts"

/** Each docs page's path under `/docs`, `""` for the docs' home. */
export function docsSlugs(): string[] {
  return plannedPages().map(({ tab, page }) => pageSlug(tab, page))
}

/** The slugs of the posts in a content collection, by their file names. */
export function postSlugs(collection: "blog" | "changelog"): string[] {
  return readdirSync(join(WEBSITE, "content", collection))
    .filter((name) => name.endsWith(".mdx"))
    .map((name) => name.slice(0, -".mdx".length))
}

/** Each docs page's address and its markdown copy, in `lang`. */
function docsPaths(lang: Lang): string[] {
  return docsSlugs().flatMap((slug) => [
    docsPath(slug === "" ? "/docs" : `/docs/${slug}`, lang),
    markdownPath(slug, lang),
  ])
}

/** Every address to prerender that crawling the pages would not reach. */
export function prerenderedPaths(): string[] {
  return [
    "/",
    "/blog",
    "/changelog",
    "/llms.txt",
    "/llms-full.txt",
    "/sitemap.xml",
    "/robots.txt",
    "/api/search",
    ...docsPaths("en"),
    ...docsPaths("zh-CN"),
    ...postSlugs("blog").map((slug) => `/blog/${slug}`),
  ]
}
