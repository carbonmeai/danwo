/**
 * Every address the static build writes. Pages linked from other pages are found by crawling;
 * these are the ones nothing links to: the markdown copy of each docs page, the files for search
 * engines and language models, and the search index.
 */
import { readdirSync } from "node:fs"
import { join } from "node:path"

import { markdownPath } from "../lib/paths.ts"
import { PROVIDERS } from "../lib/providers.ts"
import { WEBSITE } from "./generate.ts"
import { PLAN } from "./plan.ts"

/** Each docs page's path under `/docs`, `""` for the docs' home. */
export function docsSlugs(): string[] {
  return PLAN.flatMap((folder) =>
    folder.pages.flatMap((page) => {
      const own = [folder.dir, page.slug === "index" ? "" : page.slug].filter(Boolean).join("/")

      return page.source.kind === "providers"
        ? [own, ...PROVIDERS.map((provider) => `${folder.dir}/${provider.slug}`)]
        : [own]
    }),
  )
}

/** The slugs of the posts in a content collection, by their file names. */
export function postSlugs(collection: "blog" | "changelog"): string[] {
  return readdirSync(join(WEBSITE, "content", collection))
    .filter((name) => name.endsWith(".mdx"))
    .map((name) => name.slice(0, -".mdx".length))
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
    ...docsSlugs().map((slug) => (slug === "" ? "/docs" : `/docs/${slug}`)),
    ...docsSlugs().map(markdownPath),
    ...postSlugs("blog").map((slug) => `/blog/${slug}`),
  ]
}
