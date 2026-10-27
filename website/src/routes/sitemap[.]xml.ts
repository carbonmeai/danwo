import { createFileRoute } from "@tanstack/react-router"

import { postSlug } from "../lib/posts.ts"
import { SITE } from "../lib/site.ts"
import { blog, source } from "../lib/source.ts"

/** Whether a Chinese docs page is translated, rather than the English page shown in its place. */
function translated(page: {
  readonly path: string
  readonly locale?: string | undefined
}): boolean {
  return page.locale !== "zh-CN" || page.path.includes(".zh-CN.")
}

/** The pages a search engine should index: the home page, every docs page and every post. */
function addresses(): string[] {
  return [
    "/",
    "/blog",
    "/changelog",
    ...source
      .getPages()
      .filter(translated)
      .map((page) => page.url),
    ...blog.entries.map((post) => `/blog/${postSlug(post)}`),
  ]
}

/** `sitemap.xml`, listing every page at the site's own address. */
export const Route = createFileRoute("/sitemap.xml")({
  server: {
    handlers: {
      GET: () => {
        const urls = addresses()
          .map((path) => `  <url><loc>${new URL(path, SITE.url).href}</loc></url>`)
          .join("\n")

        return new Response(
          `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`,
          { headers: { "Content-Type": "application/xml; charset=utf-8" } },
        )
      },
    },
  },
})
